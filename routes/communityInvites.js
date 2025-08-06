const express = require("express");
const router = express.Router();
const CommunityInvite = require("../models/CommunityInvite");
const Community = require("../models/Community");

// 📩 Send invite to selected friends
router.post("/send", async (req, res) => {
  try {
    const { sender, recipients, communityId } = req.body;
    if (!sender || !Array.isArray(recipients) || !communityId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const invites = await Promise.all(
      recipients.map(username => {
        return CommunityInvite.create({
          sender,
          recipient: username,
          communityId
        });
      })
    );

    res.json({ success: true, invites });
  } catch (err) {
    console.error("❌ Failed to send invites:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 📨 Get all pending invites for a user
router.get("/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const invites = await CommunityInvite.find({ recipient: username, status: "pending" })
      .populate({
        path: "communityId",
        select: "name avatar description creator"
      });

    res.json({ success: true, invites });
  } catch (err) {
    console.error("❌ Failed to fetch invites:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Accept invite
router.post("/:id/accept", async (req, res) => {
  try {
    const invite = await CommunityInvite.findById(req.params.id);
    if (!invite) return res.status(404).json({ success: false, message: "Invite not found" });

    invite.status = "accepted";
    await invite.save();

    await Community.findByIdAndUpdate(invite.communityId, {
      $addToSet: { members: invite.recipient }
    });

    res.json({ success: true, message: "Invite accepted" });
  } catch (err) {
    console.error("❌ Error accepting invite:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ❌ Decline invite
router.post("/:id/decline", async (req, res) => {
  try {
    const invite = await CommunityInvite.findById(req.params.id);
    if (!invite) return res.status(404).json({ success: false, message: "Invite not found" });

    invite.status = "declined";
    await invite.save();

    res.json({ success: true, message: "Invite declined" });
  } catch (err) {
    console.error("❌ Error declining invite:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ✅ Get a single invite with populated community
router.get("/invite/:id", async (req, res) => {
  try {
    const invite = await CommunityInvite.findById(req.params.id).populate({
      path: "communityId",
      select: "name avatar description creator createdAt members"
    });

    if (!invite) return res.status(404).json({ success: false, message: "Invite not found" });

    res.json({ success: true, invite });
  } catch (err) {
    console.error("❌ Error loading invite:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


module.exports = router;
