const express = require('express');
const router = express.Router();
// Ensure JSON bodies are parsed for comment/like/save/etc.
router.use(express.json());
const mongoose = require('mongoose');
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

// ✅ Save timed captions for a specific media item (index) on a post
router.put('/:id/media/:index/captions', async (req, res) => {
  try {
    const postId = req.params.id;
    const index = Number(req.params.index);
    const { captions } = req.body;
    if (!Array.isArray(captions)) {
      return res.status(400).json({ success: false, message: 'captions must be an array' });
    }
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    if (!post.media || index < 0 || index >= post.media.length) {
      return res.status(400).json({ success: false, message: 'Invalid media index' });
    }
    const normalized = captions
      .map((c) => ({
        start: Number(c?.start || 0),
        end: Number(c?.end || 0),
        text: String(c?.text || '').trim(),
      }))
      .filter((c) => c.text.length > 0 && c.end >= c.start);
    post.media[index].captions = normalized;
    await post.save();
    return res.status(200).json({ success: true, captions: post.media[index].captions });
  } catch (err) {
    console.error('❌ Error saving captions:', err);
    return res.status(500).json({ success: false, message: 'Error saving captions' });
  }
});

// ✅ Transcribe a post's media (auto or on-demand) and store timed captions
// Body accepts: { index?: number, duration?: number }
// If TRANSCRIBE_API_URL is set, will attempt to call the external service with the media URL
router.post('/:id/transcribe', async (req, res) => {
  try {
    const postId = req.params.id;
    const { index: indexRaw, duration: durationRaw } = req.body || {};
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const inferIndex = () => {
      if (!Array.isArray(post.media)) return -1;
      if (typeof indexRaw === 'number' && indexRaw >= 0 && indexRaw < post.media.length) return indexRaw;
      const i = post.media.findIndex((m) => {
        const t = String(m?.type || '').toLowerCase();
        const u = String(m?.url || '');
        return t.includes('video') || /\/video\//.test(u) || /\.(mp4|mov|webm|m4v)$/i.test(u);
      });
      return i;
    };

    const index = inferIndex();
    if (index < 0) return res.status(400).json({ success: false, message: 'No video media found' });
    const media = post.media[index];
    const sourceUrl = String(media.url || '').trim();
    if (!sourceUrl) return res.status(400).json({ success: false, message: 'Media URL missing' });

    let segments = [];
    const providerUrl = process.env.TRANSCRIBE_API_URL;
    const providerKey = process.env.TRANSCRIBE_API_KEY;

    if (providerUrl && typeof fetch === 'function') {
      try {
        const resp = await fetch(providerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(providerKey ? { Authorization: `Bearer ${providerKey}` } : {}),
          },
          body: JSON.stringify({ url: sourceUrl })
        });
        const data = await resp.json();
        // Attempt to normalize common transcript formats
        const rawSegs = Array.isArray(data?.segments) ? data.segments : Array.isArray(data) ? data : [];
        segments = rawSegs
          .map((s) => ({ start: Number(s?.start || s?.start_time || 0), end: Number(s?.end || s?.end_time || 0), text: String(s?.text || s?.caption || '').trim() }))
          .filter((s) => s.text.length > 0 && s.end >= s.start);
      } catch (err) {
        console.error('Transcription provider error:', err);
        return res.status(502).json({ success: false, message: 'Transcription failed' });
      }
    } else {
      // Fallback heuristic: split the post caption into timed segments when provider is not configured
      const baseText = String(post.caption || '').trim();
      const duration = Number(durationRaw || 30);
      if (!baseText) {
        return res.status(400).json({ success: false, message: 'No caption text available for heuristic transcription' });
      }
      const words = baseText.split(/\s+/).filter(Boolean);
      const wordsPerSegment = Math.max(4, Math.ceil(words.length / Math.max(6, Math.ceil(duration / 5))));
      const segLen = Math.max(2, Math.min(6, Math.ceil(duration / Math.ceil(words.length / wordsPerSegment))));
      let cursor = 0;
      let t = 0;
      while (cursor < words.length) {
        const chunk = words.slice(cursor, cursor + wordsPerSegment);
        const start = t;
        const end = t + segLen;
        segments.push({ start, end, text: chunk.join(' ') });
        cursor += wordsPerSegment;
        t += segLen;
      }
    }

    post.media[index].captions = segments;
    await post.save();
    return res.status(200).json({ success: true, captions: post.media[index].captions, index });
  } catch (err) {
    console.error('❌ Error transcribing post:', err);
    return res.status(500).json({ success: false, message: 'Internal transcription error' });
  }
});


router.post('/:id/like', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ success: false, message: 'Username required' });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid post id' });
    }
    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    if (post.likedBy.includes(username)) {
      return res.status(400).json({ success: false, message: 'Already liked' });
    }

    post.likes += 1;
    post.likedBy.push(username);
    await post.save();

    if (username !== post.username) {
      try {
        const notification = await Notification.create({
          to: post.username,
          from: username,
          type: "like",
          title: "New Like",
          content: `${username} liked your post.`,
          postId: post._id
        });
        io.to(post.username).emit("new-notification", notification);
      } catch (e) {
        console.error('Notification create failed (like):', e);
      }

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
  } catch (err) {
    console.error('❌ Like error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
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
    const limitRaw = String(req.query.limit || '');
    const pageRaw = String(req.query.page || '');
    const limit = Math.min(50, Math.max(1, parseInt(limitRaw || '25', 10)));
    const page = Math.max(1, parseInt(pageRaw || '1', 10));
    const skip = (page - 1) * limit;

    // Randomize global feed irrespective of createdAt
    // Note: pagination via skip is not meaningful for random samples; we prioritize random selection.
    const sampled = await Post.aggregate([
      { $sample: { size: limit } }
    ]);

    // Bulk backfill locations for legacy posts missing location field
    const missingUsernames = Array.from(new Set(sampled.filter(p => !p.location).map(p => p.username))).filter(Boolean);
    if (missingUsernames.length > 0) {
      const users = await User.find({ username: { $in: missingUsernames } }).lean();
      const locMap = new Map(users.map(u => [u.username, u.location]));
      sampled.forEach(p => {
        if (!p.location) {
          const loc = locMap.get(p.username);
          if (loc) p.location = loc;
        }
      });
    }

    return res.status(200).json(sampled);
  } catch (err) {
    console.error('❌ Error fetching posts:', err);
    res.status(500).json({ message: 'Error fetching posts.' });
  }
});

router.get("/:username/feed", async (req, res) => {
  const { username } = req.params;

  try {
    const user = await User.findOne({ username }).lean();
    if (!user) return res.status(404).json([]);

    const limitRaw = String(req.query.limit || '');
    const pageRaw = String(req.query.page || '');
    const limit = Math.min(50, Math.max(1, parseInt(limitRaw || '25', 10)));
    const page = Math.max(1, parseInt(pageRaw || '1', 10));
    const skip = (page - 1) * limit;

    // Resolve direct friends and friends-of-friends
    const friendships = await Friendship.find({ users: username }).lean();
    const directFriends = friendships.flatMap(f => f.users.filter(u => u !== username));
    const secondDegree = directFriends.length > 0
      ? await Friendship.find({ users: { $in: directFriends } }).lean()
      : [];
    const friendsOfFriends = secondDegree.flatMap(f => f.users).filter(u => u !== username && !directFriends.includes(u));

    const allowedUsers = [...new Set([...directFriends, ...friendsOfFriends, username])];

    // Randomize user feed irrespective of post age; include sponsored and same-location
    const sampled = await Post.aggregate([
      { $match: {
          $or: [
            { username: { $in: allowedUsers } },
            { location: user.location },
            { sponsored: true }
          ]
        }
      },
      { $sample: { size: limit } }
    ]);

    // Bulk backfill location for any posts missing it
    const missingUsernames = Array.from(new Set(sampled.filter(p => !p.location).map(p => p.username))).filter(Boolean);
    if (missingUsernames.length > 0) {
      const users = await User.find({ username: { $in: missingUsernames } }).lean();
      const locMap = new Map(users.map(u => [u.username, u.location]));
      sampled.forEach(p => {
        if (!p.location) {
          const loc = locMap.get(p.username);
          if (loc) p.location = loc;
        }
      });
    }

    res.status(200).json(sampled);
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
    const { username } = req.params;
    const limitRaw = String(req.query.limit || '');
    const pageRaw = String(req.query.page || '');
    const limit = Math.min(50, Math.max(1, parseInt(limitRaw || '25', 10)));
    const page = Math.max(1, parseInt(pageRaw || '1', 10));
    const skip = (page - 1) * limit;

    const posts = await Post.find({ username })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const missingUsernames = Array.from(new Set(posts.filter(p => !p.location).map(p => p.username))).filter(Boolean);
    if (missingUsernames.length > 0) {
      const users = await User.find({ username: { $in: missingUsernames } }).lean();
      const locMap = new Map(users.map(u => [u.username, u.location]));
      posts.forEach(p => {
        if (!p.location) {
          const loc = locMap.get(p.username);
          if (loc) p.location = loc;
        }
      });
    }

    res.status(200).json(posts);
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
