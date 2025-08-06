const express = require("express");
const router = express.Router();
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const admin = require("firebase-admin");

// ✅ Log a call (save + notify receiver via FCM if they have tokens)
router.post("/", async (req, res) => {
  const { caller, receiver, status, duration, type } = req.body;

  if (!caller || !receiver || !status) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    // Save the call log
    const log = await CallLog.create({
      caller,
      receiver,
      status,
      duration: duration || 0,
      type: type || "audio"
    });

    // 🔥 Find receiver and send FCM if they have tokens
    const receiverUser = await User.findOne({ username: receiver });

    if (receiverUser && Array.isArray(receiverUser.fcmTokens) && receiverUser.fcmTokens.length > 0) {
      const payload = {
        notification: {
          title: "📞 Incoming Call",
          body: `${caller} is calling you (${type || "audio"})`,
          sound: "default"
        },
        data: {
          caller,
          type: type || "audio",
          status: status
        }
      };

      const response = await admin.messaging().sendToDevice(receiverUser.fcmTokens, payload);
      console.log("✅ FCM call alert sent to", receiver, response.successCount, "device(s)");
    } else {
      console.log("ℹ️ No FCM tokens found for", receiver);
    }

    res.json({ success: true, log });

  } catch (err) {
    console.error("❌ Error logging call or sending notification:", err);
    res.status(500).json({ success: false, message: "Server error" });
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
