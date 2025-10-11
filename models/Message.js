const mongoose = require("mongoose");

// Structured media schema aligned with community messages (supports per-item caption)
const MediaSchema = new mongoose.Schema({
  name: { type: String, required: true },      // original file name
  url: { type: String, required: true },       // Cloudinary URL
  public_id: { type: String, required: true }, // Cloudinary public_id (for deletion)
  type: { type: String, required: true },      // MIME type (e.g., 'image/png', 'application/pdf')
  caption: { type: String, default: "" },     // optional per-media caption
}, { _id: false });

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  text: { type: String, default: "" },
  caption: { type: String, default: "" },
  audio: { type: String, default: "" },
  media: { type: [MediaSchema], default: [] },
  timestamp: {
    type: Date,
    default: Date.now
  },
  hiddenFrom: {
    type: [String],
    default: []
  },
  // ✅ Reply Support
  reply: { type: String, default: "" },
  replyFrom: { type: String, default: "" },
  replyToId: { type: String, default: "" }
});

module.exports = mongoose.model("Message", messageSchema);
