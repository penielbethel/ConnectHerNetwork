const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const FriendRequest = require('../models/FriendRequest');
const Friendship = require('../models/Friendship');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Community = require('../models/Community');
const CommunityMessage = require('../models/CommunityMessage');
const CommunityInvite = require('../models/CommunityInvite');
const CallLog = require('../models/CallLog');
const { deleteFromCloudinary } = require('../cloudinary'); // root-level import
const verifyTokenAndRole = require("../middleware/verifyTokenAndRole");

// Delete a user and all their posts and media
router.delete('/:username', verifyTokenAndRole(['superadmin']), async (req, res) => {
  try {
    const { username } = req.params;

    const deletedUser = await User.findOneAndDelete({ username });
    if (!deletedUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const userPosts = await Post.find({ username });
    for (const post of userPosts) {
      if (post.media && post.media.length > 0) {
        for (const mediaItem of post.media) {
          if (mediaItem.public_id) {
            try { await deleteFromCloudinary(mediaItem.public_id); } catch (_) {}
          }
        }
      }
    }
    await Post.deleteMany({ username });

    try {
      const userPostIds = userPosts.map(p => p._id);
      if (userPostIds.length) {
        await User.updateMany({}, { $pull: { savedPosts: { $in: userPostIds } } });
      }
    } catch (_) {}

    await FriendRequest.deleteMany({ $or: [{ from: username }, { to: username }] });
    await Friendship.deleteMany({ users: { $in: [username] } });

    const dmessages = await Message.find({ $or: [{ sender: username }, { recipient: username }] });
    for (const m of dmessages) {
      try {
        if (Array.isArray(m.media)) {
          for (const item of m.media) {
            if (item.public_id) {
              try { await deleteFromCloudinary(item.public_id); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
    await Message.deleteMany({ $or: [{ sender: username }, { recipient: username }] });

    await Notification.deleteMany({ $or: [{ to: username }, { from: username }] });

    const cmessages = await CommunityMessage.find({ 'sender.username': username });
    for (const m of cmessages) {
      try {
        if (Array.isArray(m.media)) {
          for (const item of m.media) {
            if (item.public_id) {
              try { await deleteFromCloudinary(item.public_id); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
    await CommunityMessage.deleteMany({ 'sender.username': username });

    await CommunityInvite.deleteMany({ $or: [{ sender: username }, { recipient: username }] });

    await Community.updateMany({ members: username }, { $pull: { members: username } });
    await Community.updateMany({ admins: username }, { $pull: { admins: username } });
    await Community.updateMany({ creator: username }, { $set: { creator: 'deleted' } });

    await CallLog.deleteMany({ $or: [{ caller: username }, { receiver: username }, { participants: username }] });

    await Post.updateMany({ likedBy: username }, { $pull: { likedBy: username }, $inc: { likes: -1 } });
    await Post.updateMany({ 'comments.user.username': username }, { $pull: { comments: { 'user.username': username } } });
    await Post.updateMany({ 'comments.replies.user.username': username }, { $pull: { 'comments.$[].replies': { 'user.username': username } } });

    try {
      const Token = require('../models/Token');
      await Token.deleteOne({ username });
    } catch (_) {}

    res.status(200).json({ success: true, message: "User and related data deleted successfully." });

  } catch (err) {
    console.error("❌ Delete failed:", err);
    res.status(500).json({ success: false, message: "Error deleting user and their media." });
  }
});

module.exports = router;
