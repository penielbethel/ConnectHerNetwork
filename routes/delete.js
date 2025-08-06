const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const { deleteFromCloudinary } = require('../cloudinary'); // root-level import

// Delete a user and all their posts and media
router.delete('/:username', async (req, res) => {
  try {
    const { username } = req.params;

    // Step 1: Find user
    const deletedUser = await User.findOneAndDelete({ username });
    if (!deletedUser) {
      return res.status(404).json({ message: "User not found." });
    }

    // Step 2: Find all posts by the user
    const userPosts = await Post.find({ username });

    // Step 3: Delete each post's media from Cloudinary
    for (const post of userPosts) {
      if (post.media && post.media.length > 0) {
        for (const mediaItem of post.media) {
          if (mediaItem.public_id) {
            await deleteFromCloudinary(mediaItem.public_id);
          }
        }
      }
    }

    // Step 4: Delete the posts from DB
    await Post.deleteMany({ username });

    res.status(200).json({ message: "User and their posts (including media) deleted successfully." });

  } catch (err) {
    console.error("❌ Delete failed:", err);
    res.status(500).json({ message: "Error deleting user and their media." });
  }
});

module.exports = router;
