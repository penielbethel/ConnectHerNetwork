// 📦 Load required packages
const User = require('./models/User');
const FriendRequest = require('./models/FriendRequest');
const Friendship = require('./models/Friendship');
const Post = require('./models/Post');
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
require("dotenv").config();
require('events').EventEmitter.defaultMaxListeners = 30; 
const app = express();
// Parse JSON and URL-encoded bodies globally
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 🚧 Maintenance Mode (affects both web and app)
// Toggle ON by setting env MAINTENANCE_MODE=true or committing a file named 'maintenance.flag' in repo root.
const MAINTENANCE_MODE = (process.env.MAINTENANCE_MODE === 'true') || fs.existsSync(path.join(__dirname, 'maintenance.flag'));
app.use((req, res, next) => {
  if (MAINTENANCE_MODE) {
    // Serve suspended page for GET; 503 for non-GET/API calls
    if (req.method === 'GET') {
      try {
        return res.sendFile(path.join(__dirname, 'public', 'suspended.html'));
      } catch (_) {
        return res.status(503).send('Service temporarily suspended');
      }
    }
    return res.status(503).json({ message: 'Service temporarily suspended' });
  }
  next();
});
// 🔔 Firebase Admin for push notifications
const admin = require('./firebase');
const https = require('https');
const verifyTokenAndRole = require('./middleware/verifyTokenAndRole');

// 🛠️ CORS Middleware
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      "http://localhost",
      "http://localhost:8080",
      "http://127.0.0.1",
      "https://localhost",
      "capacitor://localhost",
      "https://connecther.network"
    ];

    if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost")) {
      callback(null, true);
    } else {
      console.warn("🚫 CORS blocked for origin:", origin);
      callback(new Error("Not allowed by CORS: " + origin));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200
};
// ✅ Apply globally
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

const statsRoutes = require("./routes/stats");
app.use("/api", statsRoutes);
const notificationRoutes = require("./routes/notifications");
const Notification = require("./models/Notification"); // for group call logs
app.use("/api/notifications", notificationRoutes);
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  pingInterval: 15000,
  pingTimeout: 20000,
  cors: {
    origin: "*", // Or restrict to your frontend origin
    methods: ["GET", "POST"]
  }
});
module.exports.io = io;
const onlineUsers = new Set();
const userHeartbeats = new Map();
app.set("io", io);

// Presence timeout sweeper: mark users offline when heartbeat is stale
setInterval(async () => {
  const now = Date.now();
  for (const [username, last] of userHeartbeats.entries()) {
    if (now - last > 45000) {
      if (onlineUsers.has(username)) {
        onlineUsers.delete(username);
        io.emit("user-offline", username);
        io.emit("update-online-users", Array.from(onlineUsers));
        try {
          await User.updateOne({ username }, { lastSeen: new Date(last) });
        } catch (err) {
          console.error("❌ Failed to persist lastSeen on timeout:", err);
        }
      }
      userHeartbeats.delete(username);
    }
  }
}, 15000);

// Scheduled streamer: periodically emit rotation signals and a random older post to all clients
// Controlled via env: STREAM_OLDER_POSTS_MS (default 10000), OLDER_POST_CUTOFF_DAYS (default 14)
const STREAM_OLDER_POSTS_MS = Number(process.env.STREAM_OLDER_POSTS_MS || 10000);
const OLDER_POST_CUTOFF_DAYS = Number(process.env.OLDER_POST_CUTOFF_DAYS || 14);

setInterval(async () => {
  try {
    // Signal clients to re-randomize feed order for unengaged posts
    io.emit('randomize-feed', { ts: Date.now(), reason: 'idle-rotation' });

    const cutoffDate = new Date(Date.now() - OLDER_POST_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
    const sample = await Post.aggregate([
      { $match: { createdAt: { $lt: cutoffDate } } },
      { $sample: { size: 1 } }
    ]);
    if (sample && sample.length > 0) {
      const post = sample[0];
      // Backfill missing location from user profile if needed
      if (!post.location && post.username) {
        try {
          const u = await User.findOne({ username: post.username }).lean();
          if (u?.location) post.location = u.location;
        } catch (_) {}
      }
      io.emit('random-older-post', post);
    }
  } catch (err) {
    console.error('❌ Scheduled random older post stream error:', err);
  }
}, STREAM_OLDER_POSTS_MS);
const communityRoutes = require('./routes/communities');
app.use("/api/communities", communityRoutes);

// 🗑️ Delete route
const deleteRoute = require('./routes/delete');
app.use('/api/delete', deleteRoute);

app.use("/api/communities", require("./routes/communityMessages"));


// ✅ Bulk Delete for Notifications or Call Logs
app.post('/api/notifications/bulk-delete', async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided." });
  }

  try {
    // If notifications and calls are stored in the same collection:
    await Notification.deleteMany({ _id: { $in: ids } });

    // If you're also deleting from a separate 'Call' collection, you can do:
    // await Call.deleteMany({ _id: { $in: ids } });

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Bulk delete failed:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});


// 🔗 API Routes
const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

const postRoutes = require('./routes/posts');
app.use('/api/posts', postRoutes);

// 📎 Media proxy download (Cloudinary fallback)
app.get('/api/media/proxy-download', verifyTokenAndRole(['user','admin','superadmin']), async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    const filename = String(req.query.filename || 'file');

    if (!rawUrl) {
      return res.status(400).json({ message: 'Missing url parameter' });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid url parameter' });
    }

    const host = parsed.hostname || '';
    const allowed = /(^|\.)cloudinary\.com$/i.test(host) || /(^|\.)res\.cloudinary\.com$/i.test(host);
    if (!allowed) {
      return res.status(400).json({ message: 'Only Cloudinary URLs are allowed' });
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const MAX_REDIRECTS = 3;

    const pipeFrom = (targetUrl, redirectsLeft) => {
      try {
        const u = new URL(targetUrl);
        const client = u.protocol === 'http:' ? require('http') : https;
        const reqUp = client.get(targetUrl, (upstream) => {
          const code = upstream.statusCode || 0;
          const loc = upstream.headers.location;

          if (code >= 300 && code < 400 && loc && redirectsLeft > 0) {
            return pipeFrom(loc, redirectsLeft - 1);
          }

          if (code >= 400) {
            upstream.resume(); // drain
            return res.status(502).json({ message: `Upstream error ${code}` });
          }

          res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
          if (upstream.headers['content-length']) {
            res.setHeader('Content-Length', upstream.headers['content-length']);
          }
          res.setHeader('Cache-Control', 'no-store');

          upstream.on('error', (err) => {
            console.error('Proxy stream error:', err);
            try { res.status(502).end('Proxy stream failed'); } catch (_) {}
          });

          upstream.pipe(res);
        });

        reqUp.on('error', (err) => {
          console.error('Proxy request error:', err);
          try { res.status(502).json({ message: 'Proxy fetch failed', error: err.message }); } catch (_) {}
        });
      } catch (err) {
        console.error('Proxy internal error:', err);
        return res.status(500).json({ message: 'Proxy internal error' });
      }
    };

    pipeFrom(rawUrl, MAX_REDIRECTS);
  } catch (err) {
    console.error('Proxy route error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

const userRoutes = require("./routes/users");
app.use('/api/users', userRoutes);


const callRoutes = require("./routes/calls");
app.use("/api/calls", callRoutes);

app.use("/api/community-invites", require("./routes/communityInvites"));

app.use(express.static(path.join(__dirname, 'public')));

app.use("/api/upload", require("./routes/upload"));

const adminRoutes = require("./routes/admin");
app.use("/api/admin", adminRoutes);

app.use("/api/sponsors", require("./routes/sponsors"));

app.use('/uploads', express.static('uploads'));



// 🌐 Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// 🏁 Base route
app.get("/", (req, res) => {
  res.send("🌐 Welcome to ConnectHer API – backend is running.");
});

// ===============================
// ✅ Delete Account: Page + Request Email
// ===============================
// Serve the friendly URL without .html
app.get('/delete-account', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'public', 'delete-account.html'));
  } catch (err) {
    console.error('Failed to serve delete-account page:', err);
    res.status(500).send('Failed to load page');
  }
});

// Handle deletion requests and forward to support via email
app.post('/api/delete-account', async (req, res) => {
  try {
    const { email, username, reason, details, consent } = req.body || {};
    if (!email || !consent) {
      return res.status(400).json({ success: false, message: 'Email and consent are required.' });
    }

    const now = new Date().toISOString();
    const requesterIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

    const to = process.env.EMAIL_TO || 'connecthernetwork01@gmail.com';
    const from = process.env.EMAIL_FROM || 'no-reply@connecther.network';
    const subject = `Delete Account Request – ${email}${username ? ` (${username})` : ''}`;
    const text = [
      `A user requested account and data deletion:`,
      `Time: ${now}`,
      `IP: ${requesterIp}`,
      `Email: ${email}`,
      `Username: ${username || 'N/A'}`,
      `Reason: ${reason || 'N/A'}`,
      `Details: ${details || 'N/A'}`,
      `Consent: ${consent ? 'Yes' : 'No'}`,
    ].join('\n');

    const html = `
      <p><strong>Account deletion request</strong></p>
      <ul>
        <li><strong>Time:</strong> ${now}</li>
        <li><strong>IP:</strong> ${requesterIp}</li>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Username:</strong> ${username || 'N/A'}</li>
        <li><strong>Reason:</strong> ${reason || 'N/A'}</li>
        <li><strong>Consent:</strong> ${consent ? 'Yes' : 'No'}</li>
      </ul>
      <p><strong>Details</strong></p>
      <pre style="white-space:pre-wrap">${(details || 'N/A').replace(/[<>]/g, '')}</pre>
    `;

    // Create transporter from environment variables if available
    let transporter = null;
    try {
      if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
        const secure = (process.env.SMTP_SECURE === 'true') || (String(process.env.SMTP_PORT) === '465');
        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT),
          secure,
          auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          } : undefined,
        });
      }
    } catch (txErr) {
      console.warn('Email transporter configuration error:', txErr);
    }

    if (transporter) {
      try {
        const info = await transporter.sendMail({ from, to, subject, text, html });
        console.log('✅ Delete request email dispatched:', info.messageId);
        return res.json({ success: true, message: 'Request sent to support.' });
      } catch (mailErr) {
        console.error('❌ Failed to send delete request email:', mailErr);
        // Fall through to fallback response below
      }
    }

    // Fallback when SMTP is not configured: return success and provide mailto link
    const mailto = `mailto:${to}?subject=${encodeURIComponent('Account Deletion Request')}&body=${encodeURIComponent(
      `Please delete my account and associated data.\n\nEmail: ${email}\nUsername: ${username || ''}\nReason: ${reason || ''}\nDetails: ${details || ''}`
    )}`;
    return res.json({ success: true, message: 'Request received.', emailFallback: mailto });
  } catch (err) {
    console.error('❌ Error in /api/delete-account:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});


// ===============================
// ✅ FRIEND REQUEST SYSTEM (MongoDB)
// ===============================

// 🚀 Send Friend Request
app.post('/friend-request', async (req, res) => {
  const { from, to } = req.body;

  if (from === to) {
    return res.status(400).json({ success: false, message: "You can't send request to yourself" });
  }

  try {
    // Prevent duplicates
    const exists = await FriendRequest.findOne({ from, to });
    if (exists) {
      return res.json({ success: false, message: "Request already sent" });
    }

    await FriendRequest.create({ from, to });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error sending request:", err);
    res.status(500).json({ success: false });
  }
});

// 📥 Get Requests for User
app.get('/friend-requests/:username', async (req, res) => {
  try {
    const requests = await FriendRequest.find({ to: req.params.username });
    const usernames = requests.map(r => r.from);
    res.json(usernames);
  } catch (err) {
    console.error("❌ Error fetching requests:", err);
    res.status(500).json([]);
  }
});

// ✅ Accept Friend Request
app.post('/friend-accept', async (req, res) => {
  const { user1, user2 } = req.body;

  try {
    if (!user1 || !user2) {
      return res.status(400).json({ success: false, message: 'Missing users' });
    }

    // Avoid duplicates – check if friendship already exists regardless of order
    const exists = await Friendship.exists({ users: { $all: [user1, user2] } });
    if (!exists) {
      await Friendship.create({ users: [user1, user2] });
    }

    // Clean up any pending requests in either direction
    await FriendRequest.deleteMany({
      $or: [
        { from: user2, to: user1 },
        { from: user1, to: user2 }
      ]
    });
    // Notify both parties via Socket.IO
    try {
      io.to(user1).emit('friendship-accepted', { by: user2 });
      io.to(user2).emit('friendship-accepted', { by: user1 });
      // Refresh suggestions for both users
      io.to(user1).emit('refresh-suggestions');
      io.to(user2).emit('refresh-suggestions');
    } catch (emitErr) {
      console.warn('⚠️ Socket emit failed for friendship-accepted:', emitErr);
    }

    // Push notifications to both users (multi-device)
    try {
      const [u1, u2] = await Promise.all([
        User.findOne({ username: user1 }),
        User.findOne({ username: user2 }),
      ]);

      const titleToRequester = 'Friend Request Accepted';
      const bodyToRequester = `@${user1} accepted your friend request`;
      const titleToAccepter = 'Friendship Created';
      const bodyToAccepter = `You are now friends with @${user2}`;

      // Save to DB for requester
      try {
        await Notification.create({
          to: user2,
          from: user1,
          type: 'other',
          title: titleToRequester,
          content: bodyToRequester,
        });
        const io = req.app.get('io');
        if (io) io.to(user2).emit('new-notification', { to: user2, from: user1, type: 'other', title: titleToRequester, content: bodyToRequester, createdAt: new Date() });
      } catch (_) {}

      // Save to DB for accepter (cross-device awareness)
      try {
        await Notification.create({
          to: user1,
          from: user2,
          type: 'other',
          title: titleToAccepter,
          content: bodyToAccepter,
        });
        const io = req.app.get('io');
        if (io) io.to(user1).emit('new-notification', { to: user1, from: user2, type: 'other', title: titleToAccepter, content: bodyToAccepter, createdAt: new Date() });
      } catch (_) {}

      const sendToTokens = async (tokens = [], title = '', body = '', data = {}) => {
        if (!Array.isArray(tokens) || tokens.length === 0) return;
        const messages = tokens.map((token) => ({
          token,
          notification: { title, body, sound: 'notify' },
          android: {
            priority: 'high',
            notification: { channel_id: 'connecther_notifications', sound: 'default', visibility: 'public' },
          },
          apns: { payload: { aps: { sound: 'default' } } },
          data: {
            type: 'friend',
            action: 'accepted',
            user1,
            user2,
            ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
          },
        }));

        const results = await Promise.allSettled(messages.map((m) => admin.messaging().send(m)));
        // Cleanup invalid tokens
        const invalid = [];
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            const code = r.reason?.errorInfo?.code;
            if (['messaging/registration-token-not-registered', 'messaging/invalid-argument'].includes(code)) {
              invalid.push(tokens[i]);
            }
          }
        });
        return invalid;
      };

      // Notify original requester (user2)
      const invalid2 = await sendToTokens(u2?.fcmTokens || [], titleToRequester, bodyToRequester, { username: user1 });
      if (invalid2?.length) {
        try {
          u2.fcmTokens = (u2.fcmTokens || []).filter((t) => !invalid2.includes(t));
          await u2.save();
        } catch (_) {}
      }
      // Notify accepter (user1)
      const invalid1 = await sendToTokens(u1?.fcmTokens || [], titleToAccepter, bodyToAccepter, { username: user2 });
      if (invalid1?.length) {
        try {
          u1.fcmTokens = (u1.fcmTokens || []).filter((t) => !invalid1.includes(t));
          await u1.save();
        } catch (_) {}
      }
    } catch (pushErr) {
      console.warn('⚠️ Push notifications for friend-accept failed:', pushErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error accepting request:", err);
    res.status(500).json({ success: false });
  }
});

// ❌ Decline Friend Request
app.post('/friend-decline', async (req, res) => {
  const { from, to } = req.body;

  try {
    await FriendRequest.deleteOne({ from, to });
    // Inform both users and refresh suggestions
    try {
      io.to(from).emit('friendship-declined', { by: to });
      io.to(from).emit('refresh-suggestions');
      io.to(to).emit('refresh-suggestions');
    } catch (emitErr) {
      console.warn('⚠️ Socket emit failed for friendship-declined:', emitErr);
    }

    // Push notifications to requester (from) and decliner (to)
    try {
      const [uDecliner, uRequester] = await Promise.all([
        User.findOne({ username: to }),
        User.findOne({ username: from }),
      ]);

      const titleToRequester = 'Friend Request Declined';
      const bodyToRequester = `@${to} declined your friend request`;
      const titleToDecliner = 'Request Declined';
      const bodyToDecliner = `You declined @${from}'s friend request`;

      // Save to DB entries
      try {
        await Notification.create({ to: from, from: to, type: 'other', title: titleToRequester, content: bodyToRequester });
        const io = req.app.get('io');
        if (io) io.to(from).emit('new-notification', { to: from, from: to, type: 'other', title: titleToRequester, content: bodyToRequester, createdAt: new Date() });
      } catch (_) {}
      try {
        await Notification.create({ to: to, from: from, type: 'other', title: titleToDecliner, content: bodyToDecliner });
        const io = req.app.get('io');
        if (io) io.to(to).emit('new-notification', { to: to, from: from, type: 'other', title: titleToDecliner, content: bodyToDecliner, createdAt: new Date() });
      } catch (_) {}

      const sendToTokens = async (tokens = [], title = '', body = '', data = {}) => {
        if (!Array.isArray(tokens) || tokens.length === 0) return;
        const messages = tokens.map((token) => ({
          token,
          notification: { title, body, sound: 'notify' },
          android: {
            priority: 'high',
            notification: { channel_id: 'connecther_notifications', sound: 'default', visibility: 'public' },
          },
          apns: { payload: { aps: { sound: 'default' } } },
          data: {
            type: 'friend',
            action: 'declined',
            from,
            to,
            ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
          },
        }));
        const results = await Promise.allSettled(messages.map((m) => admin.messaging().send(m)));
        const invalid = [];
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            const code = r.reason?.errorInfo?.code;
            if (['messaging/registration-token-not-registered', 'messaging/invalid-argument'].includes(code)) {
              invalid.push(tokens[i]);
            }
          }
        });
        return invalid;
      };

      const invalidRequester = await sendToTokens(uRequester?.fcmTokens || [], titleToRequester, bodyToRequester, { username: to });
      if (invalidRequester?.length) {
        try {
          uRequester.fcmTokens = (uRequester.fcmTokens || []).filter((t) => !invalidRequester.includes(t));
          await uRequester.save();
        } catch (_) {}
      }
      const invalidDecliner = await sendToTokens(uDecliner?.fcmTokens || [], titleToDecliner, bodyToDecliner, { username: from });
      if (invalidDecliner?.length) {
        try {
          uDecliner.fcmTokens = (uDecliner.fcmTokens || []).filter((t) => !invalidDecliner.includes(t));
          await uDecliner.save();
        } catch (_) {}
      }
    } catch (pushErr) {
      console.warn('⚠️ Push notifications for friend-decline failed:', pushErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error declining request:", err);
    res.status(500).json({ success: false });
  }
});

// ===============================
// ✅ Start the server
// ===============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server live with Socket.IO at: http://localhost:${PORT}`);
});

app.get("/api/users/user/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json(null);
    
    const fullName = `${user.firstName} ${user.surname}`;
    res.json({ name: fullName, avatar: user.avatar, username: user.username });
    
  } catch (err) {
    console.error("❌ Failed to fetch user:", err);
    res.status(500).json(null);
  }
});

app.get('/api/friends/:username', async (req, res) => {
  try {
    const username = req.params.username;

    const friendships = await Friendship.find({
      users: username
    });

    const friendUsernames = [...new Set(friendships.map(f =>
      f.users.find(u => u !== username)
    ))];

    const users = await User.find({ username: { $in: friendUsernames } });

    const formatted = users.map(user => ({
      username: user.username,
      avatar: user.avatar,
      name: `${user.firstName} ${user.surname}`,
      status: "online" // You can change this later to real status
    }));

    res.json(formatted);

  } catch (err) {
    console.error("❌ Failed to get friends:", err);
    res.status(500).json([]);
  }
});

// 🧹 Maintenance: reconcile friendships in DB (dedupe, remove invalid)
app.post('/api/friends/reconcile', async (req, res) => {
  try {
    const all = await Friendship.find({});
    const beforeCount = all.length;

    // Group by sorted pair key
    const groups = new Map();
    for (const f of all) {
      const users = Array.isArray(f.users) ? [...f.users] : [];
      if (users.length !== 2) continue;
      users.sort();
      const key = users.join('|');
      const arr = groups.get(key) || [];
      arr.push(f);
      groups.set(key, arr);
    }

    let duplicatesRemoved = 0;
    let invalidRemoved = 0;

    // Remove duplicates (keep the first by created order)
    for (const [_key, list] of groups) {
      if (list.length > 1) {
        // Sort by _id timestamp ascending, keep first
        list.sort((a, b) => String(a._id).localeCompare(String(b._id)));
        const toDelete = list.slice(1);
        for (const d of toDelete) {
          await Friendship.deleteOne({ _id: d._id });
          duplicatesRemoved++;
        }
      }
    }

    // Remove friendships where one or both users no longer exist
    const afterDupes = await Friendship.find({});
    for (const f of afterDupes) {
      const [u1, u2] = f.users || [];
      const user1 = await User.findOne({ username: u1 });
      const user2 = await User.findOne({ username: u2 });
      if (!user1 || !user2) {
        await Friendship.deleteOne({ _id: f._id });
        invalidRemoved++;
      }
    }

    const finalCount = await Friendship.countDocuments({});
    res.json({ success: true, beforeCount, duplicatesRemoved, invalidRemoved, finalCount });
  } catch (err) {
    console.error('❌ Reconcile friendships failed:', err);
    res.status(500).json({ success: false, message: 'Reconcile failed' });
  }
});
// Check if two users are friends (mutual friendship)
app.get('/api/friends/check/:user1/:user2', async (req, res) => {
  const { user1, user2 } = req.params;

  try {
    const areFriends = await Friendship.exists({
      users: { $all: [user1, user2] }
    });

    res.json({ areFriends: !!areFriends });
  } catch (err) {
    console.error("❌ Error checking friendship:", err);
    res.status(500).json({ areFriends: false });
  }
});



// ✅ Clear chat for current user only
app.post("/api/messages/clear", async (req, res) => {
  const { user1, user2 } = req.body;
  try {
    await Message.updateMany({
      $or: [
        { sender: user1, recipient: user2 },
        { sender: user2, recipient: user1 }
      ]
    }, {
      $addToSet: { hiddenFrom: user1 }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error clearing chat:", err);
    res.status(500).json({ success: false });
  }
});

// Mount messages router (single source of truth for media + caption handling)
app.use('/api/messages', require('./routes/messages'));
io.on("connection", (socket) => {
  console.log("🧠 New client connected:", socket.id);
    // ✅ Join community room (for community.html chat)
  socket.on("join-community", (communityId) => {
    socket.join(communityId);
    console.log(`🏘️ Joined community room: ${communityId}`);
  });

  // ✅ When a message is sent to the community
const Community = require('./models/Community'); // adjust path if needed

socket.on("send-community-message", async (message) => {
  if (!message.recipient) return;

  const { recipient, sender, text } = message;

  // ✅ Emit to community room (exclude sender)
  socket.to(recipient).emit("community-message", message);
  console.log(`📤 Sent to community ${recipient} (excluding sender):`, text || "[media]");

  try {
    // ✅ Lookup community members
    const community = await Community.findById(recipient);
    if (!community || !community.members) return;

    // ✅ Emit to each member directly for badge on dashboard.html
    community.members.forEach(member => {
      if (member !== sender) {
        io.to(member).emit("community-message", message);
      }
    });
  } catch (err) {
    console.error("❌ Failed to emit to community members:", err);
  }
});


socket.on("messageDeleted", ({ _id, sender, recipient }) => {
  const roomId = [sender, recipient].sort().join("_");
  io.to(roomId).emit("messageDeleted", { _id });
});

  socket.on("joinRoom", ({ user1, user2 }) => {
    const roomId = [user1, user2].sort().join("_");
    socket.join(roomId);
    console.log(`🔗 ${user1} and ${user2} joined room: ${roomId}`);
  });

  socket.on("editMessage", ({ _id, sender, recipient, newText }) => {
    const roomId = [sender, recipient].sort().join("_");
    io.to(roomId).emit("messageEdited", { _id, newText });
  });

  socket.on("disconnect", () => {
    console.log("👋 Client disconnected:", socket.id);
  });

    socket.on("typing", ({ from, to }) => {
    const roomId = [from, to].sort().join("_");
    socket.to(roomId).emit("typing", { from });
  });

  socket.on("stopTyping", ({ from, to }) => {
    const roomId = [from, to].sort().join("_");
    socket.to(roomId).emit("stopTyping", { from });
  });

  
// 🟣 COMMUNITY TYPING INDICATOR
socket.on("typing-community", ({ room, from }) => {
  socket.to(room).emit("typing-community", { from });
});
socket.on("stopTyping-community", ({ room, from }) => {
  socket.to(room).emit("stopTyping-community", { from });
});
socket.on("register", (username) => {
  if (username) {
    socket.join(username); // 👥 Join room named after username
    console.log(`✅ ${username} joined personal room`);
  }
});
socket.on("friend-request-status", (toUser) => {
  io.to(toUser).emit("refresh-suggestions");
});
socket.on("register", (username) => {
  socket.username = username;
  if (!onlineUsers.has(username)) {
    onlineUsers.add(username);
    io.emit("user-online", username);
  }
  userHeartbeats.set(username, Date.now());
  io.emit("update-online-users", Array.from(onlineUsers));
});
socket.on("disconnect", async () => {
  console.log("👋 Client disconnected:", socket.id);

  if (socket.username) {
    onlineUsers.delete(socket.username);
    io.emit("user-offline", socket.username);
    io.emit("update-online-users", Array.from(onlineUsers));
    // ✅ Update lastSeen in DB
    try {
      await User.updateOne(
        { username: socket.username },
        { lastSeen: new Date() }
      );
      console.log(`📅 Updated lastSeen for ${socket.username}`);
    } catch (err) {
      console.error("❌ Failed to update lastSeen:", err);
    }
  }
});

// ===============================================
// 🔒 COMMUNITY CALL SIGNALING BLOCK (Audio ONLY)
// ===============================================
socket.on("register", (username) => {
  if (!username) return;
  socket.username = username;
  socket.join(username); // Private room for DM & call alerts
  if (!onlineUsers.has(username)) {
    onlineUsers.add(username);
    io.emit("user-online", username);
  }
  userHeartbeats.set(username, Date.now());
  io.emit("update-online-users", Array.from(onlineUsers));
  console.log(`✅ Registered user socket: ${username}`);
});

// ✅ STEP 2: Caller starts group call
socket.on("incoming-group-call", async ({ from, communityId, communityName, members, type }) => {
  try {
    const callRoom = `call_${communityId}`;
    socket.join(callRoom);
    socket.data.isCaller = true;
    socket.data.communityId = communityId;

    console.log(`📞 ${from} is starting a group call in community: ${communityId}`);

    let notifiedCount = 0;

    for (const member of members) {
      if (member !== from) {
        const targetSocket = Array.from(io.sockets.sockets.values())
          .find(s => s.username === member);

        if (targetSocket) {
          io.to(member).emit("incoming-group-call", {
            from,
            communityId,
            communityName,
            type
          });
          notifiedCount++;
        }

        // Always log notification for missed call tab
        try {
          await Notification.create({
            to: member,
            from,
            communityId,
            type: "group-call",
            title: `📞 Group Call from ${from}`,
            content: `You were invited to a group call in "${communityName}"`,
          });
        } catch (err) {
          console.error(`❌ Failed to save group call notification for ${member}:`, err);
        }
      }
    }

    // Notify caller that alert was dispatched
    socket.emit("group-call-alert-dispatched", {
      communityId,
      memberCount: members.length,
      notifiedCount
    });
  } catch (err) {
    console.error("❌ Error handling incoming-group-call:", err);
  }
});

// ✅ STEP 3: Receiver accepts / joins group call
socket.on("join-group-call", ({ username, communityId, communityName, name, avatar }) => {
  try {
    const callRoom = `call_${communityId}`;
    socket.join(callRoom);

    if (!callStartTimes.has(communityId)) {
      callStartTimes.set(communityId, Date.now());
      console.log(`📞 Call started for community: ${communityId}`);
    }

    const startTime = callStartTimes.get(communityId);
    socket.emit("call-start-time", { timestamp: startTime });

    socket.data.isCaller = false;
    socket.data.communityId = communityId;
    socket.username = username;
    socket.name = name;
    socket.avatar = avatar;

    // Send current participants to new user
    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(callRoom) || []);
    const participants = socketsInRoom.map(socketId => {
      const s = io.sockets.sockets.get(socketId);
      return s?.username ? {
        username: s.username,
        name: s.name || s.username,
        avatar: s.avatar || "https://via.placeholder.com/50"
      } : null;
    }).filter(Boolean);
    socket.emit("group-call-participants", participants);

    // Notify others of the new joiner
    socket.to(callRoom).emit("group-call-joined", { username, name, avatar });

    // Tell the original caller to enter call page if not yet there
    const callerSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.data.isCaller && s.data.communityId === communityId);
    if (callerSocket) {
      callerSocket.emit("group-call-start", { communityId, communityName });
    }

    socket.data.joinedGroupCall = true;
    activeCalls.set(communityId, true);

    console.log(`👤 ${username} joined group call (${communityId})`);
  } catch (err) {
    console.error("❌ Error in join-group-call:", err);
  }
});

// ✅ STEP 4: Handle decline
socket.on("decline-group-call", async ({ username, communityId }) => {
  try {
    const callRoom = `call_${communityId}`;
    socket.leave(callRoom);
    socket.emit("call-declined", { username });

    await Notification.create({
      to: username,
      from: "system",
      communityId,
      type: "group-call",
      title: `❌ You declined a group call`,
      content: `You declined the group call in community (${communityId})`,
    });

    console.log(`❌ ${username} declined group call (${communityId})`);
  } catch (err) {
    console.error("❌ Failed to handle decline-group-call:", err);
  }
});

// ✅ STEP 5: Handle leaving the group call
socket.on("leave-group-call", ({ communityId, username }) => {
  try {
    const callRoom = `call_${communityId}`;
    socket.leave(callRoom);
    socket.to(callRoom).emit("group-call-left", { username });
    console.log(`👋 ${username} left group call (${communityId})`);

    setTimeout(() => {
      const room = io.sockets.adapter.rooms.get(callRoom);
      if (!room || room.size === 0) {
        callStartTimes.delete(communityId);
        activeCalls.delete(communityId);
        console.log(`🧹 Call room "${callRoom}" has been cleared`);
      }
    }, 500);
  } catch (err) {
    console.error("❌ Error in leave-group-call:", err);
  }
});

// ✅ Cleanup on disconnect
socket.on("disconnect", async () => {
  try {
    const communityId = socket.data?.communityId;
    const username = socket.username;

    console.log(`👋 Socket disconnected: ${username || socket.id}`);

    if (communityId && username) {
      const callRoom = `call_${communityId}`;
      socket.to(callRoom).emit("group-call-left", { username });

      if (!socket.data?.joinedGroupCall) {
        // ✅ Save missed call to DB
        await Notification.create({
          to: username,
          from: "system",
          communityId,
          type: "group-call",
          title: `📴 Missed Group Call`,
          content: `You missed a group call in "${communityId}"`,
        });
        console.log(`📴 Logged missed call for ${username}`);

        // ✅ Send FCM notification
        const user = await User.findOne({ username });
        if (user?.fcmToken) {
          const fcmPayload = {
            notification: {
              title: "Missed Group Call",
              body: `You missed a call in "${communityId}"`,
              sound: "default"
            },
            android: {
    priority: "high",
    notification: {
      channel_id: "alerts",
      sound: "default",
      vibrate_timings_millis: [0, 500, 500, 1000, 500, 2000],
      visibility: "public",
      notification_priority: "PRIORITY_MAX",
      default_light_settings: true
              }
            },
            token: user.fcmToken
          };
          await admin.messaging().send(fcmPayload);
        }
      }

      setTimeout(() => {
        const room = io.sockets.adapter.rooms.get(`call_${communityId}`);
        if (!room || room.size === 0) {
          callStartTimes.delete(communityId);
          activeCalls.delete(communityId);
          console.log(`🧹 Call room "call_${communityId}" cleaned after disconnect`);
        }
      }, 500);
    }
  } catch (err) {
    console.error("❌ Error in disconnect cleanup:", err);
  }
});


// ✅ WebRTC SIGNALING: Offer/Answer/ICE
socket.on("offer", ({ to, from, sdp }) => {
  const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.username === to);
  if (targetSocket) {
    targetSocket.emit("offer", { from, sdp });
  } else {
    console.warn(`⚠️ Offer target ${to} not connected`);
  }
});

socket.on("answer", ({ to, from, sdp }) => {
  const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.username === to);
  if (targetSocket) {
    targetSocket.emit("answer", { from, sdp });
  } else {
    console.warn(`⚠️ Answer target ${to} not connected`);
  }
});

socket.on("ice-candidate", ({ to, from, candidate }) => {
  const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.username === to);
  if (targetSocket) {
    targetSocket.emit("ice-candidate", { from, candidate });
  } else {
    console.warn(`⚠️ ICE candidate target ${to} not connected`);
  }
});

// ✅ reJoin live check
socket.on("check-call-alive", ({ communityId }) => {
  const room = io.sockets.adapter.rooms.get(`call_${communityId}`);
  const isAlive = !!(room && room.size > 0);
  socket.emit("call-alive-status", { isAlive });
});

// ✅ Host-controlled mute/unmute for group calls
// - Broadcasts `toggle-mute-status` to the call room for UI/state sync
// - Sends `force-mute-status` directly to target to hard-disable local mic
socket.on("toggle-mute-status", ({ communityId, target, action }) => {
  try {
    if (!communityId || !target || !action) return;
    const callRoom = `call_${communityId}`;
    const shouldMute = String(action).toLowerCase() === "mute";

    // Broadcast to the room for UI updates
    io.to(callRoom).emit("toggle-mute-status", { username: target, isMuted: shouldMute });

    // Directly signal the target to enforce mic state
    const targetSocket = Array.from(io.sockets.sockets.values()).find((s) => s.username === target);
    if (targetSocket) {
      targetSocket.emit("force-mute-status", { isMuted: shouldMute });
    }
  } catch (err) {
    console.error("❌ Error in toggle-mute-status:", err);
  }
});



// ===============================================
// 🔒 PRIVATE CALL SIGNALING BLOCK (Audio & Video) NEWMEK
// ===============================================
socket.on("start-call", async ({ from, to, type = "audio", name, avatar }) => {
  console.log(`📞 Private call request from ${from} to ${to} [${type}]`);

  // ✅ Socket.IO delivery to recipient if online
  io.to(to).emit("incomingCall", {
    from,
    name: name || from,
    avatar: avatar || "default.jpg",
    type
  });

  // ✅ FCM Notification for offline users
  const targetUser = await User.findOne({ username: to });
  if (targetUser?.fcmToken) {
    const fcmPayload = {
      notification: {
        title: `Incoming ${type} call from ${from}`,
        body: "Tap to join the call",
        sound: "default"  
      },
      android: {
    priority: "high",
    notification: {
      channel_id: "alerts",
      sound: "default",
      vibrate_timings_millis: [0, 500, 500, 1000, 500, 2000],
      visibility: "public",
      notification_priority: "PRIORITY_MAX",
      default_light_settings: true
        }
      },
      token: targetUser.fcmToken
    };
    try {
      await admin.messaging().send(fcmPayload);
      console.log(`📲 FCM sent to ${to} for incoming ${type} call`);
    } catch (err) {
      console.error(`❌ FCM error for ${to}:`, err);
    }
  }
});

// ✅ When receiver accepts the call
socket.on("accept-call", ({ from, to }) => {
  console.log(`✅ ${to} accepted the call from ${from}`);
  io.to(from).emit("call-accepted", { from: to });
});

// ❌ When receiver declines the call
socket.on("decline-call", ({ from, to }) => {
  console.log(`❌ ${to} declined the call from ${from}`);
  io.to(from).emit("private-end-call", { from: to, reason: "declined" });
});

// 🎥 WebRTC Offer
socket.on("private-offer", ({ from, to, offer, type }) => {
  console.log(`📤 Offer [${type}] from ${from} to ${to}`);
  io.to(to).emit("private-offer", { from, offer, type });
});

// 🔄 WebRTC Answer
socket.on("private-answer", ({ from, to, answer }) => {
  console.log(`📥 Answer from ${from} to ${to}`);
  io.to(to).emit("private-answer", { from, answer });
});

// ❄️ WebRTC ICE Candidate
socket.on("private-ice-candidate", ({ from, to, candidate }) => {
  io.to(to).emit("private-ice-candidate", { from, candidate });
});

// 🚫 Call Ended by one party
socket.on("private-end-call", ({ from, to, reason = "ended" }) => {
  console.log(`📴 ${from} ended the call with ${to} (reason: ${reason})`);
  io.to(to).emit("private-end-call", { from, reason });
});


});




