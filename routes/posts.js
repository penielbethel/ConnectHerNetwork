const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Friendship = require("../models/Friendship");
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const io = require('../server').io;
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
    res.status(200).json(post);
  } catch (err) {
    console.error("❌ Error updating post:", err);
    res.status(500).json({ message: 'Error updating post' });
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
    res.status(200).json({ message: "Post and media deleted" });
  } catch (err) {
    console.error("❌ Error deleting post:", err);
    res.status(500).json({ message: "Error deleting post" });
  }
});


// ✅ Reshare route (media remains same, no changes to Cloudinary)
router.post('/reshare', async (req, res) => {
  try {
    const { originalPostId, username } = req.body;

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
        type: "like",
        title: "Post Shared",
        content: `${username} shared your post.`,
        postId: original._id
      });
      io.to(original.username).emit("new-notification", notification);
    }

const resharedPost = new Post({
  name: user.name || `${user.firstName} ${user.surname}`,
  username: user.username,
  avatar: user.avatar,
  caption: `Shared a post from ${original.name}${original.caption ? ': ' + original.caption : ''}`,
  media: original.media,
  contentType: original.contentType || "",
  content: original.content || "",
  likes: 0,
  shares: 0,
  comments: [],
  likedBy: [],
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

  if (!post || !user) return res.status(404).json({ message: 'Post or User not found' });

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
  }

  res.status(201).json(post.comments);
});


router.post('/:id/like', async (req, res) => {
  const { username } = req.body;
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found' });

  if (post.likedBy.includes(username)) {
    return res.status(400).json({ message: 'Already liked' });
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
  }

  res.json({ likes: post.likes });
});


router.post('/:postId/comment/:commentIndex/reply', async (req, res) => {
  try {
    const { postId, commentIndex } = req.params;
    const { username, text } = req.body;

    const post = await Post.findById(postId);
    const user = await User.findOne({ username });

    if (!post || !user || !post.comments || !post.comments[commentIndex]) {
      return res.status(404).json({ message: 'Post, user, or comment not found' });
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

    post.comments[commentIndex].replies.push(reply);
    await post.save();

    res.status(201).json(post.comments[commentIndex].replies);
  } catch (err) {
    console.error("❌ Reply error:", err);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// ✅ Feed, search, and user-post routes – untouched
router.get('/', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.status(200).json(posts);
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

    const posts = await Post.find().sort({ createdAt: -1 });
    const filtered = posts.filter(p =>
      allowedUsers.includes(p.username) ||
      p.location === user.location || 
      p.sponsored === true
    );

    res.status(200).json(filtered);
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
    res.status(200).json(posts);
  } catch (err) {
    console.error("Failed to fetch posts by user:", err);
    res.status(500).json({ message: "Server error fetching posts" });
  }
});


module.exports = router;
