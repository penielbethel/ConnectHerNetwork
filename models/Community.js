const mongoose = require("mongoose");

const communitySchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  avatar: String,
  creator: { type: String, required: true },
  members: [String],
  admins: [String],
  isLocked: { type: Boolean, default: false },


  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Community", communitySchema);
