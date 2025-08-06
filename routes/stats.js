const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Sponsor = require("../models/Sponsor");
const verifyTokenAndRole = require("../middleware/verifyTokenAndRole");

// Get total number of users
router.get("/users/count", verifyTokenAndRole(["admin", "superadmin"]), async (req, res) => {
  try {
    const count = await User.countDocuments({});
    res.json({ count });
  } catch (err) {
    console.error("User Count Error:", err);
    res.status(500).json({ message: "Failed to retrieve user count." });
  }
});

// 🔁 Increment views
router.post("/post/:sponsorId/:postId/view", async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    const post = sponsor?.posts.id(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    post.views += 1;
    await sponsor.save();
    res.json({ message: "View recorded" });
  } catch (err) {
    console.error("View Analytics Error:", err);
    res.status(500).json({ message: "Failed to record view" });
  }
});

// 🔗 Increment clicks
router.post("/post/:sponsorId/:postId/click", async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    const post = sponsor?.posts.id(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    post.clicks += 1;
    await sponsor.save();
    res.json({ message: "Click recorded" });
  } catch (err) {
    console.error("Click Analytics Error:", err);
    res.status(500).json({ message: "Failed to record click" });
  }
});






module.exports = router;
