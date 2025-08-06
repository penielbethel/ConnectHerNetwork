const mongoose = require("mongoose");

const friendshipSchema = new mongoose.Schema({
  users: [{ type: String, required: true }], // [user1, user2]
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Friendship", friendshipSchema);
