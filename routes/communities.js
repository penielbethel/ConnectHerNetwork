const express = require("express");
const router = express.Router();
const Community = require("../models/Community");
const multer = require("multer");
const path = require("path");



// Storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

// ✅ Create new community
router.post("/create", async (req, res) => {
  try {
    const { name, description, avatar, username } = req.body;

    if (!name || !username) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }


    const newCommunity = await Community.create({
      name,
      description,
      avatar: avatar || "https://via.placeholder.com/50",
      creator: username,
      members: [username],
      admins: [username],
    });

    res.json({ success: true, community: newCommunity });
  } catch (err) {
    console.error("❌ Failed to create community:", err);
    res.status(500).json({ success: false });
  }
});


// ✅ Get a specific community by its ID
router.get("/user/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const owned = await Community.find({ creator: username });
    const joined = await Community.find({
      members: username,
      creator: { $ne: username },
    });

    res.json({ owned, joined });
  } catch (err) {
    console.error("❌ Failed to fetch user communities:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Get a specific community by its ID to Load Members
router.get("/:id", async (req, res) => {
  try {
    const community = await Community.findById(req.params.id); // Uses native _id now
    if (!community) {
      return res.status(404).json({ success: false, message: "Community not found" });
    }
    res.json({ success: true, community });
  } catch (err) {
    console.error("❌ Failed to get community:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ✅ Get all communities
router.get("/all", async (req, res) => {
  try {
    const communities = await Community.find({});
    res.json(communities);
  } catch (err) {
    console.error("❌ Failed to fetch communities:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Leave community
router.post("/:id/leave", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, message: "Missing username" });

    const community = await Community.findById(req.params.id); // ✅ FIXED TO _id
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    community.members = community.members.filter(m => m !== username);
    community.admins = community.admins.filter(a => a !== username);

    // If creator left and no admins remain, delete
    if (community.creator === username && community.admins.length === 0) {
      await Community.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: "Community deleted as no admins remain" });
    }

    await community.save();
    res.json({ success: true, message: "Left community successfully" });

  } catch (err) {
    console.error("❌ Failed to leave community:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


const User = require("../models/User");

router.get("/:id/members", async (req, res) => {
  try {
    const community = await Community.findById(req.params.id); // ✅ FIXED TO _id
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const users = await User.find({ username: { $in: community.members } })
      .select("username firstName surname avatar");

    const members = community.members.map(username => {
      const user = users.find(u => u.username === username);
      return {
        username,
        name: user ? `${user.firstName} ${user.surname}` : username,
        avatar: user ? user.avatar : "https://via.placeholder.com/40?text=U",
        isAdmin: community.admins.includes(username),
        isCreator: community.creator === username
      };
    });

    res.json({ success: true, members });

  } catch (err) {
    console.error("❌ Failed to load members:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ JOIN community via invite link
router.post("/:id/join", async (req, res) => {
  try {
    const communityId = req.params.id;
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required." });
    }

    const community = await Community.findById(communityId);
    if (!community) {
      return res.status(404).json({ success: false, message: "Community not found." });
    }

    if (community.members.includes(username)) {
      return res.json({ success: false, message: "User already a member." });
    }

    community.members.push(username);
    await community.save();

    res.json({ success: true, message: "Joined community successfully." });
  } catch (err) {
    console.error("❌ Error joining community:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ✅ Promote a user to admin
router.post("/:id/promote", async (req, res) => {
  try {
    const communityId = req.params.id;
    const { username } = req.body;

    if (!username) return res.status(400).json({ success: false, message: "Username is required" });

    const community = await Community.findById(communityId);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    if (!community.members.includes(username)) {
      return res.status(400).json({ success: false, message: "User is not a member" });
    }

    if (community.admins.includes(username)) {
      return res.status(400).json({ success: false, message: "User is already an admin" });
    }

    community.admins.push(username);
    await community.save();

    res.json({ success: true, message: `${username} is now an admin.` });
  } catch (err) {
    console.error("❌ Error promoting to admin:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Demote an admin (only creator can do this)
router.post("/:id/demote", async (req, res) => {
  try {
    const communityId = req.params.id;
    const { username } = req.body;

    if (!username) return res.status(400).json({ success: false, message: "Username is required" });

    const community = await Community.findById(communityId);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    if (!community.admins.includes(username)) {
      return res.status(400).json({ success: false, message: "User is not an admin" });
    }

    // Remove the username from the admins list
    community.admins = community.admins.filter(admin => admin !== username);
    await community.save();

    res.json({ success: true, message: `${username} has been demoted.` });
  } catch (err) {
    console.error("❌ Error demoting admin:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Remove member
router.post("/:id/remove-member", async (req, res) => {
  const { username, target } = req.body;

  const community = await Community.findById(req.params.id);
  if (!community) return res.status(404).json({ success: false, message: "Community not found" });

  const isAdmin = community.admins.includes(username) || community.creator === username;

  if (!isAdmin) {
    return res.status(403).json({ success: false, message: "Only admins can remove members." });
  }

  if (target === community.creator) {
    return res.status(403).json({ success: false, message: "Cannot remove the community creator." });
  }

  community.members = community.members.filter(m => m !== target);
  community.admins = community.admins.filter(a => a !== target);
  await community.save();

  res.json({ success: true, message: "Member removed." });
});


// ✅ Edit community info (with optional file or URL)
router.patch("/:id/edit", upload.single("avatarFile"), async (req, res) => {
  try {
    const { username, name, description, avatar } = req.body;

    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const isAdmin = community.admins.includes(username) || community.creator === username;
    if (!isAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });

    if (name) community.name = name;
    if (description) community.description = description;

    // ✅ Use uploaded file if present
    if (req.file) {
      const fullUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      community.avatar = fullUrl;
    }

    // ✅ OR use avatar URL from JSON
    if (!req.file && avatar) {
      community.avatar = avatar;
    }

    await community.save();
    res.json({ success: true, community });
  } catch (err) {
    console.error("❌ Edit error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Lock or unlock community chat
router.patch("/:id/lock", async (req, res) => {
  const { username, lock } = req.body; // lock = true or false

  const community = await Community.findById(req.params.id);
  if (!community) return res.status(404).json({ success: false, message: "Community not found" });

  const isAdmin = community.admins.includes(username) || community.creator === username;
  if (!isAdmin) return res.status(403).json({ success: false, message: "Only admins can lock/unlock." });

  community.isLocked = lock;
  await community.save();

    // ✅ Emit socket event
  const io = req.app.get("io");
  io.emit("group-lock-status-changed", {
    communityId: community._id.toString(),
    isLocked: community.isLocked
  });

  res.json({ success: true, locked: community.isLocked });
});





module.exports = router;
