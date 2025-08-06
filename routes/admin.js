// routes/admin.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const verifyTokenAndRole = require("../middleware/verifyTokenAndRole");

const SECRET = process.env.JWT_SECRET || "FORam8n8ferans#1";

// 🔐 Generate Invite Token (Only for SuperAdmins)
router.post("/generate-invite", verifyTokenAndRole(["superadmin"]), (req, res) => {
  const { role } = req.body;
  if (!role || !["admin", "superadmin"].includes(role)) {
    return res.status(400).json({ message: "Invalid role." });
  }

  const inviteToken = jwt.sign({ role, type: "invite" }, SECRET, { expiresIn: "2h" });
  res.json({ inviteToken });
});

// 🧑 Promote a user to admin (Only for SuperAdmins)
router.post("/promote/:username", verifyTokenAndRole(["superadmin"]), async (req, res) => {
  const { username } = req.params;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found." });

    user.role = "admin";
    await user.save();

    res.json({ message: `${username} promoted to admin.` });
  } catch (err) {
    console.error("Error promoting user:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// 👥 List all users (Only for SuperAdmins)
router.get("/users", verifyTokenAndRole(["superadmin"]), async (req, res) => {
  try {
    const users = await User.find({}, "username email role").sort({ username: 1 });
    res.json({ users });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: "Error retrieving users" });
  }
});

// 🔻 Demote an admin back to user (SuperAdmin only)
router.post("/demote/:username", verifyTokenAndRole(["superadmin"]), async (req, res) => {
  const { username } = req.params;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found." });

    if (user.role !== "admin") {
      return res.status(400).json({ message: `${username} is not an admin.` });
    }

    user.role = "user";
    await user.save();

    res.json({ message: `${username} has been demoted to user.` });
  } catch (err) {
    console.error("Error demoting user:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});


module.exports = router;
