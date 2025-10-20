const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const User = require("../models/User");
const admin = require("../firebase"); // Firebase Admin SDK
const Sponsor = require("../models/Sponsor");

router.use(express.json());

/**
 * ✅ GET sponsor alerts visible to all users
 */
router.get("/sponsor-alerts", async (req, res) => {
  try {
    const alerts = await Notification.find({ forAll: true, type: "sponsor" })
      .sort({ createdAt: -1 })
      .limit(20);

    // Enrich each alert with sponsor name/logo and normalize fields for client
    const enriched = await Promise.all(
      alerts.map(async (n) => {
        let sponsor = null;
        let caption = undefined;
        let jobLink = undefined;
        try {
          if (n.sponsorId) {
            const s = await Sponsor.findById(n.sponsorId);
            if (s) {
              sponsor = { name: s.companyName, avatar: s.logo };
              // Try to recover caption/jobLink from latest post if postId not present
              if (!n.postId && Array.isArray(s.posts) && s.posts.length > 0) {
                const last = s.posts[s.posts.length - 1];
                caption = last?.caption;
                jobLink = last?.jobLink;
              }
            }
          }
        } catch (_) {}
        const sponsorName = sponsor?.name || "Sponsor";
        const baseTitle = n.title || "New Sponsorship Alert";
        const title = baseTitle.includes(sponsorName)
          ? baseTitle
          : `${baseTitle} from ${sponsorName}`;
        const message = n.content || (caption ? String(caption) : "Tap to view sponsor details");
        return {
          _id: n._id,
          type: "sponsor",
          title,
          message,
          sender: {
            username: "sponsor",
            name: sponsorName,
            avatar: sponsor?.avatar || "",
          },
          data: {
            sponsorId: n.sponsorId ? String(n.sponsorId) : undefined,
            postId: n.postId ? String(n.postId) : undefined,
            caption: caption,
            jobLink: jobLink,
          },
          isRead: !!n.read,
          createdAt: n.createdAt,
        };
      })
    );

    res.json(enriched);
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
  const { toUsername, title, body, type = "alert", forAll = false, data: extraData = {} } = req.body;
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

    const normalizeData = (obj) => {
      const out = {};
      try {
        Object.entries(obj || {}).forEach(([k, v]) => {
          if (v === undefined || v === null) return;
          // FCM data must be strings
          out[String(k)] = typeof v === 'string' ? v : String(v);
        });
      } catch (_) {}
      return out;
    };

    const baseData = { type, forAll: String(forAll), createdAt: newNotif.createdAt.toISOString(), url: "/dashboard.html" };
    const mergedData = { ...baseData, ...normalizeData(extraData) };

    const channelForType = (t) => {
      const tc = String(t || '').toLowerCase();
      if (tc === 'group_call' || tc === 'incoming_call' || tc === 'call') return 'connecther_calls';
      if (tc === 'community_message' || tc === 'message' || tc === 'community_reaction') return 'connecther_messages';
      return 'connecther_notifications';
    };

    const messages = user.fcmTokens.map(token => ({
      token,
      // Admin SDK Notification only supports title/body/image; sound must be set via platform-specific payloads
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          channel_id: channelForType(type),
          visibility: 'public'
        }
      },
      apns: { payload: { aps: { sound: 'default' } } },
      data: mergedData,
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
