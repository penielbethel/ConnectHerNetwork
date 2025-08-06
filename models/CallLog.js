// models/CallLog.js
const mongoose = require("mongoose");

const CallLogSchema = new mongoose.Schema({
  caller: { type: String, required: true }, // Can be a username or community initiator
  receiver: { type: String, required: true }, // Can be a user or "community" string
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: "Community", default: null }, // Used only for group calls
  participants: [{ type: String }], // Group call participants (usernames)
  timestamp: { type: Date, default: Date.now },
  duration: { type: Number, default: 0 }, // in seconds
  status: {
    type: String,
    enum: ["missed", "declined", "answered", "ended"],
    default: "missed"
  },
  type: {
    type: String,
    enum: ["audio", "video", "group-audio", "group-video"],
    default: "audio"
  }
});

module.exports = mongoose.model("CallLog", CallLogSchema);
