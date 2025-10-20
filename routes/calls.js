const express = require("express");
const router = express.Router();
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const Community = require("../models/Community");
const admin = require("firebase-admin");

// ✅ Log a call (save + notify receiver via FCM if they have tokens)
router.post("/", async (req, res) => {
  const { caller, receiver, status, duration, type } = req.body;

  if (!caller || !receiver || !status) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    // Save the call log first
    const log = await CallLog.create({
      caller,
      receiver,
      status,
      duration: duration || 0,
      type: type || "audio",
    });

    // Attempt to send FCM notification but DO NOT fail the request if FCM fails
    try {
      const receiverUser = await User.findOne({ username: receiver });
      if (receiverUser && Array.isArray(receiverUser.fcmTokens) && receiverUser.fcmTokens.length > 0) {
        const payload = {
          // Data-only payload to allow client to render full-screen call UI with actions
          data: {
            type: 'incoming_call',
            caller,
            callType: type || 'audio',
            receiver,
            status: status || 'ringing',
          },
          android: {
            priority: 'high',
          },
        };

        const response = await admin.messaging().sendToDevice(receiverUser.fcmTokens, payload);
        console.log("✅ FCM call alert sent to", receiver, response.successCount, "device(s)");
      } else {
        console.log("ℹ️ No FCM tokens found for", receiver);
      }
    } catch (fcmErr) {
      console.warn("⚠️ FCM send failed, continuing without notification:", fcmErr?.message || fcmErr);
    }

    // Always return success for the call log creation
    res.json({ success: true, log });
  } catch (err) {
    console.error("❌ Error logging call:", err);
    res.status(500).json({ success: false, message: "Server error saving call log" });
  }
});

// 📥 Get call logs for a specific user
router.get("/:username", async (req, res) => {
  try {
    const logs = await CallLog.find({
      $or: [{ caller: req.params.username }, { receiver: req.params.username }]
    }).sort({ timestamp: -1 });

    res.json(logs);
  } catch (err) {
    console.error("❌ Error fetching call logs:", err);
    res.status(500).json([]);
  }
});

// ❌ Delete a call log by ID
router.delete("/:id", async (req, res) => {
  try {
    await CallLog.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting call log:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Bulk delete call logs
router.post("/bulk-delete", async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  try {
    const result = await CallLog.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error("❌ Bulk delete error:", err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;

// 🚀 Broadcast a group call start to all community members via FCM
router.post('/group-start', async (req, res) => {
  const { communityId, caller, type } = req.body;

  if (!communityId || !caller) {
    return res.status(400).json({ success: false, message: 'Missing communityId or caller' });
  }

  try {
    const community = await Community.findById(communityId);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const memberUsernames = Array.isArray(community.members) ? community.members.filter(u => u && u !== caller) : [];
    if (memberUsernames.length === 0) {
      return res.json({ success: true, notified: 0 });
    }

    // Fetch users to collect FCM tokens
    const users = await User.find({ username: { $in: memberUsernames } });
    const tokens = users
      .map(u => Array.isArray(u.fcmTokens) ? u.fcmTokens : [])
      .flat()
      .filter(Boolean);

    if (tokens.length === 0) {
      console.log('ℹ️ No FCM tokens found for community members of', communityId);
      return res.json({ success: true, notified: 0 });
    }

    const payload = {
      notification: {
        title: '📢 Incoming Group Call',
        body: `${caller} started a ${type || 'audio'} call in ${community.name || 'community'}`,
        sound: 'default',
        image: community.avatar || undefined,
      },
      data: {
        type: 'group_call',
        caller,
        callType: type || 'audio',
        communityId: String(communityId),
        communityName: community.name || '',
        communityAvatar: community.avatar || '',
      },
    };

    try {
      const response = await admin.messaging().sendToDevice(tokens, payload);
      console.log('✅ FCM group call alert sent to', response.successCount, 'device(s)');
      return res.json({ success: true, notified: response.successCount });
    } catch (fcmErr) {
      console.warn('⚠️ FCM group call send failed:', fcmErr?.message || fcmErr);
      // Do not fail request due to FCM issues
      return res.json({ success: true, notified: 0 });
    }
  } catch (err) {
    console.error('❌ Error broadcasting group call start:', err);
    return res.status(500).json({ success: false, message: 'Server error broadcasting group call' });
  }
});
