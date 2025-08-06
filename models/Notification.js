const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  read: { type: Boolean, default: false },
  forAll: { type: Boolean, default: false }, // true = visible to all users

  title: { type: String, trim: true },
  content: { type: String, trim: true },

  sponsorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sponsor",
    default: null,
  },

  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post",
    default: null
  },

  // 👤 User-specific fields
  to: { type: String, default: null },     // Username of recipient
  from: { type: String, default: null },   // Username of sender (if any)

  // 🏷️ Notification type
  type: {
    type: String,
    required: true,
    enum: [
      "friend-request",
      "join-community",
      "sponsor",
      "message",
      "call",
      "like",
      "comment",
      "other",
      "group-call" // ✅ NEW: Group call events (missed, declined, ended)
    ]
  },

  // 🏘️ Optional community reference
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Community",
    default: null,
  },

  // 🕓 Timestamp
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Notification", notificationSchema);
