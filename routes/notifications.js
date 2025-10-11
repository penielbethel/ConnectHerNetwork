const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const User = require("../models/User");
const admin = require("../firebase"); // Firebase Admin SDK

router.use(express.json());

/**
 * ✅ GET sponsor alerts visible to all users
 */
router.get("/sponsor-alerts", async (req, res) => {
  try {
    const alerts = await Notification.find({ forAll: true, type: "sponsor" })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json(alerts);
  } catch (err) {
    console.error("❌ Error fetching sponsor alerts:", err);
    res.status(500).json([]);
  }
});

/**
 * ✅ GET like/comment notifications for a user
 */
router.get("/likes-comments/:username", async (req, res) => {
  try {
    const alerts = await Notification.find({
      to: req.params.username,
      type: { $in: ["like", "comment", "reply", "share"] }
    }).sort({ createdAt: -1 });

    // Enrich notifications with sender details and normalize fields for client
    const enriched = await Promise.all(
      alerts.map(async (n) => {
        let sender = null;
        if (n.from) {
          const u = await User.findOne({ username: n.from });
          if (u) {
            sender = { username: u.username, name: u.name || `${u.firstName} ${u.surname}`.trim(), avatar: u.avatar };
          } else {
            sender = { username: n.from, name: n.from, avatar: "" };
          }
        }
        return {
          _id: n._id,
          type: n.type,
          title: n.title,
          message: n.content,
          sender,
          isRead: !!n.read,
          createdAt: n.createdAt,
          data: { postId: n.postId },
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("❌ Error fetching likes/comments notifications:", err);
    res.status(500).json([]);
  }
});

/**
 * ✅ GET group call notifications
 */
router.get("/group-call/:username", async (req, res) => {
  try {
    const alerts = await Notification.find({
      to: req.params.username,
      type: "group-call"
    }).sort({ createdAt: -1 }).limit(50);

    res.json(alerts);
  } catch (err) {
    console.error("❌ Error fetching group call notifications:", err);
    res.status(500).json([]);
  }
});

/**
 * ✅ Mark a notification as read
 */
router.put("/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to mark notification as read:", err);
    res.status(500).json({ success: false });
  }
});

/**
 * ✅ Delete a notification
 */
router.delete("/:id", async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error deleting notification:", err);
    res.status(500).json({ success: false });
  }
});

/**
 * ✅ Save FCM token(s) for a user (multi-device)
 */
router.post("/save-token", async (req, res) => {
  const { username, token } = req.body;
  if (!username || !token) return res.status(400).json({ message: "Username and token required." });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found." });

    if (!Array.isArray(user.fcmTokens)) user.fcmTokens = [];
    if (!user.fcmTokens.includes(token)) {
      user.fcmTokens.push(token);
      await user.save();
      console.log(`✅ Saved new FCM token for ${username}`);
    }

    res.json({ success: true, message: "FCM token saved." });
  } catch (err) {
    console.error("❌ Error saving FCM token:", err);
    res.status(500).json({ success: false });
  }
});

/**
 * ✅ Send push notification & save to DB (multi-device)
 */
router.post("/send", async (req, res) => {
  const { toUsername, title, body, type = "alert", forAll = false } = req.body;
  if (!toUsername || !title || !body) return res.status(400).json({ message: "Missing required fields." });

  try {
    // Save to DB
    const newNotif = await Notification.create({ to: toUsername, title, body, type, forAll });

    // Socket.IO real-time badge
    const io = req.app.get("io");
    if (io) io.to(toUsername).emit("new-notification", newNotif);

    // Fetch user and tokens
    const user = await User.findOne({ username: toUsername });
    if (!user?.fcmTokens || user.fcmTokens.length === 0) {
      return res.json({ success: true, message: "Notification saved, no tokens to push.", notification: newNotif });
    }

    const messages = user.fcmTokens.map(token => ({
      token,
      notification: { title, body, sound: "notify" },
      android: { priority: "high", notification: { channel_id: "connecther_notifications", sound: "default", visibility: "public" } },
      apns: { payload: { aps: { sound: "default" } } },
      data: { type, forAll: String(forAll), createdAt: newNotif.createdAt.toISOString(), url: "/dashboard.html" }
    }));

    // Send notifications
    const results = await Promise.allSettled(messages.map(msg => admin.messaging().send(msg)));

    // Cleanup invalid tokens
    const invalidTokens = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const reason = r.reason?.errorInfo?.code;
        if (["messaging/registration-token-not-registered", "messaging/invalid-argument"].includes(reason)) {
          invalidTokens.push(user.fcmTokens[i]);
        }
      }
    });

    if (invalidTokens.length > 0) {
      user.fcmTokens = user.fcmTokens.filter(t => !invalidTokens.includes(t));
      await user.save();
      console.log(`🧹 Removed invalid tokens for ${toUsername}:`, invalidTokens);
    }

    res.json({ success: true, fcmResults: results, notification: newNotif });

  } catch (err) {
    console.error("❌ Error sending push notification:", err);
    res.status(500).json({ success: false, message: "Push/send failed." });
  }
});

module.exports = router;
