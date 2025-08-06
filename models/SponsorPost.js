const mongoose = require("mongoose");

const sponsorPostSchema = new mongoose.Schema({
  sponsorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sponsor",
    required: true
  },
  mediaUrl: String,
  mediaPublicId: String, // ✅ Track for Cloudinary deletion
  caption: String,
  jobLink: String,
  views: {
    type: Number,
    default: 0
  },
  clicks: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("SponsorPost", sponsorPostSchema);
