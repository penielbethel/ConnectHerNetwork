const express = require("express");
const router = express.Router();
const User = require("../models/User"); // use model
const Friendship = require("../models/Friendship");
const FriendRequest = require("../models/FriendRequest");

// ✅ Get user by username
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // ✅ Ensure joined date is set
    if (!user.joined) {
      if (user.createdAt) {
        user.joined = user.createdAt.toISOString().split("T")[0];
      } else if (user._id && user._id.getTimestamp) {
        user.joined = user._id.getTimestamp().toISOString().split("T")[0];
      } else {
        user.joined = new Date().toISOString().split("T")[0];
      }
    }

    const { password, ...userData } = user._doc;
    userData.joined = user.joined; // ✅ Attach joined to output
    res.status(200).json({ user: userData });

  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/:username/friends', async (req, res) => {
  try {
    const friendships = await Friendship.find({ users: req.params.username });

    const friendUsernames = friendships.flatMap(f =>
      f.users.filter(u => u !== req.params.username)
    );

    res.json(friendUsernames);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching friends' });
  }
});


router.get("/suggestions/:username", async (req, res) => {
  const { username } = req.params;

  try {
    const friendships = await Friendship.find({ users: username });

    const directFriends = friendships.flatMap(f =>
      f.users.filter(u => u !== username)
    );

    const allFriendships = await Friendship.find({
      users: { $in: directFriends }
    });

    const friendsOfFriends = allFriendships
      .flatMap(f => f.users)
      .filter(u => u !== username && !directFriends.includes(u));

    const sentRequests = await FriendRequest.find({ from: username });
    const pending = sentRequests.map(r => r.to);

    const uniqueSuggestions = [...new Set(friendsOfFriends)].filter(
      user => !directFriends.includes(user) && !pending.includes(user)
    );

    const suggestedUsers = await User.find({
      username: { $in: uniqueSuggestions }
    }).select("username avatar firstName surname");

    res.json(suggestedUsers);
  } catch (err) {
    console.error("❌ Suggestion error:", err);
    res.status(500).json([]);
  }
});

router.get('/last-seen/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ lastSeen: user.lastSeen });
  } catch (err) {
    console.error("❌ Failed to get last seen:", err);
    res.status(500).json({ error: "Server error" });
  }
});



module.exports = router;