const mongoose = require("mongoose");

const inviteSchema = new mongoose.Schema({
  sender: {
    type: String,
    required: true,
    index: true // 🔍 helps in faster querying by sender
  },
  recipient: {
    type: String,
    required: true,
    index: true // 🔍 helps in faster querying by recipient
  },
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Community",
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "declined"],
    default: "pending",
    index: true // 🔍 allow quick filtering of pending/accepted invites
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // 📅 adds createdAt and updatedAt automatically
});

module.exports = mongoose.model("CommunityInvite", inviteSchema);
