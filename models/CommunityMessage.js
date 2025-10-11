const mongoose = require("mongoose");

// ✅ Structured media schema for Cloudinary compatibility
const MediaSchema = new mongoose.Schema({
  name: { type: String },
  type: { type: String },
  url: { type: String },
  public_id: { type: String }, // ✅ Required for media delete/replace
  caption: { type: String, default: "" }
}, { _id: false }); // Prevent nested _id in media items

const communityMessageSchema = new mongoose.Schema({
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Community",
    required: true
  },
  sender: {
    username: { type: String, required: true },
    name: { type: String, required: true },
    avatar: { type: String, default: "https://via.placeholder.com/40?text=U" }
  },
  text: {
    type: String,
    default: ""
  },

  media: [MediaSchema], // ✅ Media now structured with public_id

  replyTo: {
    type: String,
    default: ""
  }, // ✅ Holds original message preview text

  time: {
    type: Date,
    default: Date.now
  },

  hiddenFrom: {
    type: [String], // ✅ Users who have cleared the message
    default: []
  }
});

module.exports = mongoose.model("CommunityMessage", communityMessageSchema);
