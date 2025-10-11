const express = require("express");
const router = express.Router();
const User = require("../models/User"); // use model
const Friendship = require("../models/Friendship");
const FriendRequest = require("../models/FriendRequest");
const Message = require("../models/Message");

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

// 🧹 Unfriend: remove a friendship between two users
router.post('/unfriend', async (req, res) => {
  try {
    // Accept both { user1, user2 } and legacy { from, to }
    const user1 = req.body.user1 || req.body.from;
    const user2 = req.body.user2 || req.body.to;
    if (!user1 || !user2) {
      return res.status(400).json({ success: false, message: 'Missing users' });
    }

    const deleted = await Friendship.findOneAndDelete({
      users: { $all: [user1, user2] }
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Friendship not found' });
    }

    // Soft-clear chats for both users so old conversations disappear from lists
    try {
      await Message.updateMany({
        $or: [
          { sender: user1, recipient: user2 },
          { sender: user2, recipient: user1 }
        ]
      }, {
        $addToSet: { hiddenFrom: { $each: [user1, user2] } }
      });
    } catch (msgErr) {
      console.warn('⚠️ Failed to clear chats on unfriend:', msgErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error unfriending:', err);
    res.status(500).json({ success: false, message: 'Server error' });
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

    // Exclude users with any pending friend request (sent or received) involving the current user
    const sentRequests = await FriendRequest.find({ from: username });
    const receivedRequests = await FriendRequest.find({ to: username });
    const pendingSent = sentRequests.map(r => r.to);
    const pendingReceived = receivedRequests.map(r => r.from);

    const uniqueSuggestions = [...new Set(friendsOfFriends)].filter(
      user =>
        !directFriends.includes(user) &&
        !pendingSent.includes(user) &&
        !pendingReceived.includes(user)
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
// 🔎 Resolve a user by username or full name (case-insensitive)
router.get('/resolve/:identifier', async (req, res) => {
  try {
    const raw = req.params.identifier || '';
    const identifier = raw.trim();
    if (!identifier) return res.status(400).json({ message: 'Missing identifier' });

    // Try username exact (case-insensitive)
    const usernameRegex = new RegExp(`^${identifier}$`, 'i');
    let user = await User.findOne({ username: usernameRegex });

    // Try display name exact (case-insensitive)
    if (!user) {
      const nameRegex = new RegExp(`^${identifier}$`, 'i');
      user = await User.findOne({ name: nameRegex });
    }

    // Try firstName + surname when identifier includes space
    if (!user && identifier.includes(' ')) {
      const [firstNamePart, ...rest] = identifier.split(' ').filter(Boolean);
      const surnamePart = rest.join(' ');
      if (firstNamePart && surnamePart) {
        const fnRegex = new RegExp(`^${firstNamePart}$`, 'i');
        const snRegex = new RegExp(`^${surnamePart}$`, 'i');
        user = await User.findOne({ firstName: fnRegex, surname: snRegex });
      }
    }

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Ensure joined date is set as in /:username route
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
    userData.joined = user.joined;
    res.status(200).json({ user: userData });
  } catch (err) {
    console.error('❌ Resolve user error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});