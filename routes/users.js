const express = require("express");
const router = express.Router();
const User = require("../models/User"); // use model
const Friendship = require("../models/Friendship");
const FriendRequest = require("../models/FriendRequest");
const Message = require("../models/Message");
const Post = require("../models/Post");

// ✅ Get user by username (avoid matching special endpoints)
router.get('/:username', async (req, res, next) => {
  try {
    // Skip dynamic match when path refers to a specific endpoint
    if (req.params.username === 'top-creators') {
      return next();
    }

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

router.get("/top-creators", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const forUser = (req.query.for || "").trim();

    const [friendCountsAgg, engagementAgg] = await Promise.all([
      // Count friendships per username
      Friendship.aggregate([
        { $unwind: "$users" },
        { $group: { _id: "$users", count: { $sum: 1 } } },
      ]),
      // Aggregate engagement per author username
      Post.aggregate([
        {
          $project: {
            username: 1,
            likes: { $ifNull: ["$likes", 0] },
            shares: { $ifNull: ["$shares", 0] },
            commentsCount: { $size: { $ifNull: ["$comments", []] } },
          },
        },
        {
          $group: {
            _id: "$username",
            likes: { $sum: "$likes" },
            shares: { $sum: "$shares" },
            comments: { $sum: "$commentsCount" },
          },
        },
      ]),
    ]);

    const friendCountsMap = new Map();
    for (const f of friendCountsAgg) friendCountsMap.set(f._id, f.count || 0);

    const engagementMap = new Map();
    for (const e of engagementAgg) {
      engagementMap.set(e._id, {
        likes: e.likes || 0,
        shares: e.shares || 0,
        comments: e.comments || 0,
      });
    }

    // Exclusions for the requesting user
    const excludeUsernames = new Set();
    if (forUser) {
      excludeUsernames.add(forUser);
      const [directFriendships, sentReqs, recvReqs] = await Promise.all([
        Friendship.find({ users: forUser }),
        FriendRequest.find({ from: forUser }),
        FriendRequest.find({ to: forUser }),
      ]);
      for (const fr of directFriendships) {
        for (const u of fr.users) {
          if (u !== forUser) excludeUsernames.add(u);
        }
      }
      for (const r of sentReqs) excludeUsernames.add(r.to);
      for (const r of recvReqs) excludeUsernames.add(r.from);
    }

    // Union of usernames appearing in either map
    const allUsernames = new Set([
      ...Array.from(friendCountsMap.keys()),
      ...Array.from(engagementMap.keys()),
    ]);

    const scored = [];
    for (const username of allUsernames) {
      if (excludeUsernames.has(username)) continue;
      const fc = friendCountsMap.get(username) || 0;
      const eng = engagementMap.get(username) || { likes: 0, shares: 0, comments: 0 };
      // Weighted score (tweakable): friendships(1.5x), comments(1.5x), shares(2x), likes(1x)
      const score = fc * 1.5 + eng.likes * 1 + eng.comments * 1.5 + eng.shares * 2;
      scored.push({ username, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const topUsernames = scored.slice(0, limit).map((s) => s.username);

    if (topUsernames.length === 0) return res.json([]);

    const users = await User.find({ username: { $in: topUsernames } })
      .select("username avatar firstName surname name category website bio")
      .lean();

    // Preserve ranking order
    const orderMap = new Map(topUsernames.map((u, i) => [u, i]));
    users.sort((a, b) => (orderMap.get(a.username) || 0) - (orderMap.get(b.username) || 0));

    return res.json(
      users.map((u) => ({
        username: u.username,
        avatar: u.avatar,
        firstName: u.firstName,
        surname: u.surname,
        name: u.name,
        category: u.category,
        website: u.website,
        bio: u.bio,
      }))
    );
  } catch (err) {
    console.error("/top-creators error", err);
    return res.status(500).json([]);
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