// 📦 Load required packages
const User = require('./models/User');
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
require('events').EventEmitter.defaultMaxListeners = 30; 
const app = express();
const statsRoutes = require("./routes/stats");
app.use("/api", statsRoutes);
const notificationRoutes = require("./routes/notifications");
const Notification = require("./models/Notification"); // for group call logs
app.use("/api/notifications", notificationRoutes);
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*", // Or restrict to your frontend origin
    methods: ["GET", "POST"]
  }
});
module.exports.io = io;
const onlineUsers = new Set();
app.set("io", io);

// 🗂️ MongoDB Models
const FriendRequest = require("./models/FriendRequest");
const Friendship = require("./models/Friendship");
const Message = require("./models/Message");
const callStartTimes = new Map();
const activeCalls = new Map();



// 📁 Ensure 'uploads' folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log("📁 'uploads/' folder created");
}

// 🖼️ Serve uploaded images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🛠️ CORS Middleware
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      "http://localhost",
      "https://localhost",
      "capacitor://localhost",
      "http://localhost:8080",
      "http://127.0.0.1",
      "https://connecther.network"
    ];

    // ✅ Allow mobile apps (no origin) or whitelisted origins
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost")) {
      callback(null, true);
    } else {
      console.warn("🚫 CORS blocked for origin:", origin);
      callback(new Error("Not allowed by CORS: " + origin));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200
};

// ✅ Apply globally
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));







app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


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

const userRoutes = require("./routes/users");
app.use('/api/users', userRoutes);

const messageRoutes = require('./routes/messages');
app.use('/api/messages', messageRoutes);

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
    // Save as friends
    await Friendship.create({ users: [user1, user2] });

    // Remove the pending request
    await FriendRequest.deleteOne({ from: user2, to: user1 });

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

    const friendUsernames = friendships.map(f =>
      f.users.find(u => u !== username)
    );

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

// ✅ Send a message (text, audio, or media)
app.post('/api/messages', async (req, res) => {
  const { sender, recipient, text, audio } = req.body;

  if (!sender || !recipient || (!text && !audio)) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const newMsg = await Message.create({ sender, recipient, text, audio });

    // ✅ After saving message, emit to room via Socket.IO
  const roomId = [sender, recipient].sort().join("_");
// Send to conversation.html users
io.to(roomId).emit("newMessage", newMsg);
// Send to recipient directly (for dashboard.html badge)
io.to(recipient).emit("newMessage", newMsg);
    res.json({ success: true, message: newMsg });
  } catch (err) {
    console.error("❌ Error sending message:", err);
    res.status(500).json({ success: false });
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

  // ✅ Emit to community room (for users already inside community.html)
  io.to(recipient).emit("community-message", message);
  console.log(`📤 Sent to community ${recipient}:`, text || "[media]");

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
  onlineUsers.add(username);
  io.emit("update-online-users", Array.from(onlineUsers));
});
socket.on("disconnect", async () => {
  console.log("👋 Client disconnected:", socket.id);

  if (socket.username) {
    onlineUsers.delete(socket.username);
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
  console.log(`✅ Registered user socket: ${username}`);
});

// ✅ STEP 2: Caller starts group call
socket.on("incoming-group-call", async ({ from, communityId, communityName, members }) => {
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
            communityName
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
        await Notification.create({
          to: username,
          from: "system",
          communityId,
          type: "group-call",
          title: `📴 Missed Group Call`,
          content: `You missed a group call in "${communityId}"`,
        });
        console.log(`📴 Logged missed call for ${username}`);
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




// ===============================================
// 🔒 PRIVATE CALL SIGNALING BLOCK (Audio & Video) NEWMEK
// ===============================================
socket.on("start-call", ({ from, to, type = "audio", name, avatar }) => {
  console.log(`📞 Private call request from ${from} to ${to} [${type}]`);

  // Send incoming call event to the receiver
  io.to(to).emit("incomingCall", {
    from,
    name: name || from,
    avatar: avatar || "default.jpg",
    type
  });
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




