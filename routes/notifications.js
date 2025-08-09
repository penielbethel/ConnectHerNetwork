const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const User = require("../models/User");

// ✅ Firebase Admin SDK setup - //COMMENT NEXT LINE ON COMMIT AND UNCOMMIT ON BUILD//

const admin = require('../firebase');

router.use(express.json());

/**
 * ✅ GET sponsor alerts visible to all users
 */
router.get("/sponsor-alerts", async (req, res) => {
  try {
    const alerts = await Notification.find({
      forAll: true,
      type: "sponsor"
    }).sort({ createdAt: -1 }).limit(20);

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
      type: { $in: ["like", "comment"] }
    }).sort({ createdAt: -1 });

    res.json(alerts);
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
 * ✅ Save FCM token for a user
 */
router.post("/save-token", async (req, res) => {
  const { username, token } = req.body;

  if (!username || !token) {
    return res.status(400).json({ message: "Username and token are required." });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found." });

    user.fcmToken = token;
    await user.save();

    res.json({ success: true, message: "FCM token saved." });
  } catch (err) {
    console.error("❌ Error saving FCM token:", err);
    res.status(500).json({ success: false });
  }
});

/**
 * ✅ Send push notification & save to DB
 */
router.post("/send", async (req, res) => {
  const { toUsername, title, body, type = "alert", forAll = false } = req.body;

  if (!toUsername || !title || !body) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    // Save to DB
    const newNotif = new Notification({
      to: toUsername,
      title,
      body,
      type,
      forAll
    });
    await newNotif.save();

    // 🔹 Socket.IO emit for real-time badge updates
    const io = req.app.get('io');
    if (io) {
      io.to(toUsername).emit('new-notification', {
        _id: newNotif._id,
        title,
        body,
        type,
        createdAt: newNotif.createdAt
      });
    }

    // 🔹 FCM push notification
    const user = await User.findOne({ username: toUsername });
    if (!user?.fcmToken) {
      return res.status(200).json({ success: true, message: "Notification saved, no token to push." });
    }

    const message = {
      token: user.fcmToken,
      notification: { title, body },
      data: {
        type,
        forAll: String(forAll),
        createdAt: newNotif.createdAt.toISOString(),
        url: "/notifications"
      }
    };

    const response = await admin.messaging().send(message);

    res.json({ success: true, messageId: response, notification: newNotif });
  } catch (err) {
    console.error("❌ Error sending push notification:", err);
    res.status(500).json({ success: false, message: "Push/send failed." });
  }
});

module.exports = router;
