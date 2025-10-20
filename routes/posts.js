const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Friendship = require("../models/Friendship");
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const io = require('../server').io;
const admin = require("../firebase");
const cloudinary = require('../cloudinary'); // ⬅️ Your cloudinary.js in root
const fs = require("fs");


// ✅ Create a new Post (media assumed to be uploaded via /uploads and compressed already)
router.post('/', async (req, res) => {
  const { username, caption, media } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const newPost = new Post({
      name: user.name || `${user.firstName} ${user.surname}`,
      username: user.username,
      avatar: user.avatar,
      caption,
      media: media || [], // [{ url, type, name, public_id }]
      likes: 0,
      shares: 0,
      likedBy: [],
      comments: [],
      location: user.location
    });

    await newPost.save();
    // Broadcast push notification to all users via FCM topic
    try {
      const message = {
        topic: 'new_posts',
        notification: {
          title: 'New Post',
          body: `${user.username} posted a new update`,
        },
        android: {
          priority: 'high',
          notification: {
            channel_id: 'connecther_notifications',
            sound: 'default',
          },
        },
        data: {
          type: 'post',
          postId: String(newPost._id),
        },
      };
      admin.messaging().send(message).catch((e) => {
        console.log('FCM new_post push failed', e?.message || e);
      });
    } catch (e) {
      console.log('FCM new_post push setup failed', e?.message || e);
    }

    res.status(201).json(newPost);
  } catch (err) {
    console.error("❌ Error creating post:", err);
    res.status(500).json({ message: 'Error saving post' });
  }
});


// ✅ Edit caption + optionally replace media
router.put('/:id', async (req, res) => {
  const { caption, media } = req.body;

  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    // ❌ Delete old media from Cloudinary if replaced
    if (media && media.length > 0 && post.media && post.media.length > 0) {
      for (const file of post.media) {
        if (file.public_id) {
          await cloudinary.uploader.destroy(file.public_id, {
            resource_type: "raw"
          });
        }
      }
      post.media = media; // Replace with new media
    }

    if (caption) post.caption = caption;

    await post.save();
    res.status(200).json({ success: true, post });
  } catch (err) {
    console.error("❌ Error updating post:", err);
    res.status(500).json({ success: false, message: 'Error updating post' });
  }
});


// ✅ DELETE Post + Media from Cloudinary
router.delete('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (post.media && post.media.length > 0) {
      for (const file of post.media) {
        if (file.public_id) {
          await cloudinary.uploader.destroy(file.public_id, {
            resource_type: "raw"
          });
        }
      }
    }

    await Post.findByIdAndDelete(req.params.id);

    // Broadcast deletion so all clients remove the post in real-time
    io.emit('post-deleted', { postId: String(req.params.id) });

    // Return a consistent success shape so clients can reliably detect success
    res.status(200).json({ success: true, message: "Post and media deleted" });
  } catch (err) {
    console.error("❌ Error deleting post:", err);
    res.status(500).json({ message: "Error deleting post" });
  }
});


// ✅ Reshare route (media remains same, no changes to Cloudinary)
router.post('/reshare', async (req, res) => {
  try {
    const { originalPostId, username, caption } = req.body;

    if (!originalPostId || !username) {
      return res.status(400).json({ message: 'Missing post ID or username.' });
    }

    const user = await User.findOne({ username });
    const original = await Post.findById(originalPostId);

    if (!user || !original) return res.status(404).json({ message: 'User or Original Post not found' });

    original.shares += 1;
    await original.save();

    if (username !== original.username) {
      const notification = await Notification.create({
        to: original.username,
        from: username,
        type: "share",
        title: "Post Shared",
        content: `${username} shared your post.`,
        postId: original._id
      });
      io.to(original.username).emit("new-notification", notification);

      // Push to all device tokens
      const owner = await User.findOne({ username: original.username });
      const tokens = owner?.fcmTokens || [];
      if (tokens.length > 0) {
        const messages = tokens.map(token => ({
          token,
          notification: { title: "Post Shared", body: `${username} shared your post.` },
          android: { priority: "high", notification: { channel_id: "connecther_notifications", sound: "default" } },
          data: { type: "share", postId: String(original._id) }
        }));
        try { await Promise.allSettled(messages.map(m => admin.messaging().send(m))); } catch (e) { console.log("FCM share push failed", e?.message || e); }
      }
    }

const resharedPost = new Post({
  name: user.name || `${user.firstName} ${user.surname}`,
  username: user.username,
  avatar: user.avatar,
  // Use provided caption when available, otherwise default to original attribution
  caption: (caption && String(caption).trim())
    ? String(caption).trim()
    : `Shared a post from ${original.name}${original.caption ? ': ' + original.caption : ''}`,
  // Track original post reference for future linking
  originalPostId: String(original._id),
  media: original.media,
  contentType: original.contentType || "",
  content: original.content || "",
  likes: 0,
  shares: 0,
  comments: [],
  likedBy: [],
  location: user.location
});


    await resharedPost.save();
    res.status(201).json(resharedPost);
  } catch (err) {
    console.error("Reshare Error:", err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});


// ✅ Comments, likes, replies, and feed – untouched (no Cloudinary dependency)
router.post('/:id/comment', async (req, res) => {
  const { username, text } = req.body;
  const post = await Post.findById(req.params.id);
  const user = await User.findOne({ username });

  if (!post || !user) return res.status(404).json({ success: false, message: 'Post or User not found' });

  const comment = {
    user: {
      username: user.username,
      name: user.name || `${user.firstName} ${user.surname}`,
      avatar: user.avatar
    },
    text,
    replies: []
  };

  post.comments.push(comment);
  await post.save();

  if (username !== post.username) {
    const notification = await Notification.create({
      to: post.username,
      from: username,
      type: "comment",
      title: "New Comment",
      content: `${username} commented on your post.`,
      postId: post._id
    });
    io.to(post.username).emit("new-notification", notification);

    const owner = await User.findOne({ username: post.username });
    const tokens = owner?.fcmTokens || [];
    if (tokens.length > 0) {
      const messages = tokens.map(token => ({
        token,
        notification: { title: "New Comment", body: `${username} commented on your post.` },
        android: { priority: "high", notification: { channel_id: "connecther_notifications", sound: "default" } },
        data: { type: "comment", postId: String(post._id) }
      }));
      try { await Promise.allSettled(messages.map(m => admin.messaging().send(m))); } catch (e) { console.log("FCM comment push failed", e?.message || e); }
    }
  }

  res.status(201).json({ success: true, comments: post.comments });
});


router.post('/:id/like', async (req, res) => {
  const { username } = req.body;
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

  if (post.likedBy.includes(username)) {
    return res.status(400).json({ success: false, message: 'Already liked' });
  }

  post.likes += 1;
  post.likedBy.push(username);
  await post.save();

  if (username !== post.username) {
    const notification = await Notification.create({
      to: post.username,
      from: username,
      type: "like",
      title: "New Like",
      content: `${username} liked your post.`,
      postId: post._id
    });
    io.to(post.username).emit("new-notification", notification);

    const owner = await User.findOne({ username: post.username });
    const tokens = owner?.fcmTokens || [];
    if (tokens.length > 0) {
      const messages = tokens.map(token => ({
        token,
        notification: { title: "New Like", body: `${username} liked your post.` },
        android: { priority: "high", notification: { channel_id: "connecther_notifications", sound: "default" } },
        data: { type: "like", postId: String(post._id) }
      }));
      try { await Promise.allSettled(messages.map(m => admin.messaging().send(m))); } catch (e) { console.log("FCM like push failed", e?.message || e); }
    }
  }

  res.json({ success: true, likes: post.likes });
});


router.post('/:postId/comment/:commentIndex/reply', async (req, res) => {
  try {
    const { postId, commentIndex } = req.params;
    const { username, text } = req.body;

    const post = await Post.findById(postId);
    const user = await User.findOne({ username });

    if (!post || !user || !post.comments || !post.comments[commentIndex]) {
      return res.status(404).json({ success: false, message: 'Post, user, or comment not found' });
    }

    const reply = {
      user: {
        username: user.username,
        name: user.name || `${user.firstName} ${user.surname}`,
        avatar: user.avatar
      },
      text,
      createdAt: new Date()
    };

    const comment = post.comments[commentIndex];
    comment.replies.push(reply);
    await post.save();

    // Notify original commenter (not the replier themselves)
    const commentOwner = comment?.user?.username;
    if (commentOwner && commentOwner !== username) {
      const notification = await Notification.create({
        to: commentOwner,
        from: username,
        type: "reply",
        title: "New Reply",
        content: `${username} replied to your comment.`,
        postId: post._id
      });
      io.to(commentOwner).emit("new-notification", notification);

      const owner = await User.findOne({ username: commentOwner });
      const tokens = owner?.fcmTokens || [];
      if (tokens.length > 0) {
        const messages = tokens.map(token => ({
          token,
          notification: { title: "New Reply", body: `${username} replied to your comment.` },
          android: { priority: "high", notification: { channel_id: "connecther_notifications", sound: "default" } },
          data: { type: "reply", postId: String(post._id) }
        }));
        try { await Promise.allSettled(messages.map(m => admin.messaging().send(m))); } catch (e) { console.log("FCM reply push failed", e?.message || e); }
      }
    }

    res.status(201).json({ success: true, replies: comment.replies });
  } catch (err) {
    console.error("❌ Reply error:", err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ✏️ Edit a comment (only by original commenter)
router.put('/:postId/comment/:commentIndex', async (req, res) => {
  try {
    const { postId, commentIndex } = req.params;
    const { username, text } = req.body;
    const post = await Post.findById(postId);
    if (!post || !post.comments || !post.comments[commentIndex]) {
      return res.status(404).json({ success: false, message: 'Post or comment not found' });
    }
    const comment = post.comments[commentIndex];
    if (!comment?.user?.username || comment.user.username !== username) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this comment' });
    }
    comment.text = text;
    await post.save();
    return res.status(200).json({ success: true, comments: post.comments });
  } catch (err) {
    console.error('❌ Edit comment error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// 🗑️ Delete a comment (only by original commenter)
router.delete('/:postId/comment/:commentIndex', async (req, res) => {
  try {
    const { postId, commentIndex } = req.params;
    const { username } = req.body;
    const post = await Post.findById(postId);
    if (!post || !post.comments || !post.comments[commentIndex]) {
      return res.status(404).json({ success: false, message: 'Post or comment not found' });
    }
    const comment = post.comments[commentIndex];
    if (!comment?.user?.username || comment.user.username !== username) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this comment' });
    }
    post.comments.splice(Number(commentIndex), 1);
    await post.save();
    return res.status(200).json({ success: true, comments: post.comments });
  } catch (err) {
    console.error('❌ Delete comment error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ✏️ Edit a reply (only by original replier)
router.put('/:postId/comment/:commentIndex/reply/:replyIndex', async (req, res) => {
  try {
    const { postId, commentIndex, replyIndex } = req.params;
    const { username, text } = req.body;
    const post = await Post.findById(postId);
    if (!post || !post.comments || !post.comments[commentIndex]) {
      return res.status(404).json({ success: false, message: 'Post or comment not found' });
    }
    const comment = post.comments[commentIndex];
    const reply = comment.replies?.[replyIndex];
    if (!reply) {
      return res.status(404).json({ success: false, message: 'Reply not found' });
    }
    if (!reply?.user?.username || reply.user.username !== username) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this reply' });
    }
    reply.text = text;
    await post.save();
    return res.status(200).json({ success: true, replies: comment.replies });
  } catch (err) {
    console.error('❌ Edit reply error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// 🗑️ Delete a reply (only by original replier)
router.delete('/:postId/comment/:commentIndex/reply/:replyIndex', async (req, res) => {
  try {
    const { postId, commentIndex, replyIndex } = req.params;
    const { username } = req.body;
    const post = await Post.findById(postId);
    if (!post || !post.comments || !post.comments[commentIndex]) {
      return res.status(404).json({ success: false, message: 'Post or comment not found' });
    }
    const comment = post.comments[commentIndex];
    const reply = comment.replies?.[replyIndex];
    if (!reply) {
      return res.status(404).json({ success: false, message: 'Reply not found' });
    }
    if (!reply?.user?.username || reply.user.username !== username) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this reply' });
    }
    comment.replies.splice(Number(replyIndex), 1);
    await post.save();
    return res.status(200).json({ success: true, replies: comment.replies });
  } catch (err) {
    console.error('❌ Delete reply error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


// ✅ Feed, search, and user-post routes – untouched
router.get('/', async (req, res) => {
  try {
    // Fetch all posts and randomize order like TikTok/Instagram
    const posts = await Post.find();
    const shuffled = posts.sort(() => Math.random() - 0.5);

    // Ensure location is present for legacy posts
    const withLoc = await Promise.all(shuffled.map(async (p) => {
      if (!p.location) {
        const u = await User.findOne({ username: p.username });
        if (u && u.location) p.location = u.location;
      }
      return p;
    }));
    res.status(200).json(withLoc);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching posts.' });
  }
});

router.get("/:username/feed", async (req, res) => {
  const { username } = req.params;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json([]);

    const friendships = await Friendship.find({ users: username });
    const directFriends = friendships.flatMap(f => f.users.filter(u => u !== username));
    const secondDegree = await Friendship.find({ users: { $in: directFriends } });
    const friendsOfFriends = secondDegree.flatMap(f => f.users).filter(u => u !== username && !directFriends.includes(u));

    const allowedUsers = [...new Set([...directFriends, ...friendsOfFriends, username])];

    // Randomize posts; include friends, FOAF, same-location, and sponsored
    const posts = await Post.find();
    const filtered = posts.filter(p =>
      allowedUsers.includes(p.username) ||
      p.location === user.location || 
      p.sponsored === true
    ).sort(() => Math.random() - 0.5);

    // Backfill location for any posts missing it
    const withLoc = await Promise.all(filtered.map(async (p) => {
      if (!p.location) {
        const u = await User.findOne({ username: p.username });
        if (u && u.location) p.location = u.location;
      }
      return p;
    }));

    res.status(200).json(withLoc);
  } catch (err) {
    console.error("❌ Feed error:", err);
    res.status(500).json({ message: 'Feed error' });
  }
});

router.get("/search/:query", async (req, res) => {
  const { query } = req.params;

  try {
    const posts = await Post.find({
      $or: [
        { name: new RegExp(query, "i") },
        { username: new RegExp(query, "i") },
        { caption: new RegExp(query, "i") }
      ]
    }).sort({ createdAt: -1 });

    res.json(posts);
  } catch (err) {
    console.error("❌ Search error:", err);
    res.status(500).json([]);
  }
});

router.get('/user/:username', async (req, res) => {
  try {
    const posts = await Post.find({ username: req.params.username }).sort({ createdAt: -1 });
    const withLoc = await Promise.all(posts.map(async (p) => {
      if (!p.location) {
        const u = await User.findOne({ username: p.username });
        if (u && u.location) p.location = u.location;
      }
      return p;
    }));
    res.status(200).json(withLoc);
  } catch (err) {
    console.error("Failed to fetch posts by user:", err);
    res.status(500).json({ message: "Server error fetching posts" });
  }
});

// ✅ Save a post (bookmark for later)
router.post('/:id/save', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ username });
    const post = await Post.findById(req.params.id);
    if (!user || !post) return res.status(404).json({ message: 'User or Post not found' });

    const alreadySaved = (user.savedPosts || []).some(p => String(p) === String(post._id));
    if (!alreadySaved) {
      user.savedPosts = [...(user.savedPosts || []), post._id];
      await user.save();
    }
    res.status(200).json({ success: true, saved: true });
  } catch (err) {
    console.error('❌ Error saving post:', err);
    res.status(500).json({ message: 'Error saving post' });
  }
});

// ✅ Unsave a post (remove bookmark)
router.post('/:id/unsave', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ username });
    const post = await Post.findById(req.params.id);
    if (!user || !post) return res.status(404).json({ message: 'User or Post not found' });

    user.savedPosts = (user.savedPosts || []).filter(p => String(p) !== String(post._id));
    await user.save();
    res.status(200).json({ success: true, saved: false });
  } catch (err) {
    console.error('❌ Error unsaving post:', err);
    res.status(500).json({ message: 'Error unsaving post' });
  }
});

// ✅ Get all saved posts for a user
router.get('/saved/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username }).populate('savedPosts');
    // Treat missing user as no saved posts to avoid noisy 404s in clients
    if (!user) return res.status(200).json({ posts: [] });

    const posts = (user.savedPosts || []).map(p => ({
      ...p.toObject(),
      location: p.location || user.location,
    }));
    res.status(200).json({ posts });
  } catch (err) {
    console.error('❌ Error fetching saved posts:', err);
    res.status(500).json({ message: 'Server error fetching saved posts' });
  }
});

// ✅ Get a single post by ID (placed after specific routes to avoid conflicts)
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (!post.location) {
      const u = await User.findOne({ username: post.username });
      if (u && u.location) post.location = u.location;
    }
    res.status(200).json({ post });
  } catch (err) {
    console.error('❌ Error fetching post by id:', err);
    res.status(500).json({ message: 'Server error fetching post' });
  }
});


module.exports = router;
