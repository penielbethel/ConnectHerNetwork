const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  user: {
    username: String,
    name: String,
    avatar: String
  },
  text: String,
  replies: [
    {
      user: {
        username: String,
        name: String,
        avatar: String
      },
      text: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

// ✅ Structured media array with public_id (for Cloudinary delete support)
const MediaSchema = new mongoose.Schema({
  name: { type: String },
  type: { type: String },
  url: { type: String },
  public_id: { type: String }, // Required for deleting/replacing on Cloudinary
  caption: { type: String, default: "" }
}, { _id: false }); // Avoid nested _id for each media item

const PostSchema = new mongoose.Schema({
  name: String,
  username: String,
  avatar: String,
  caption: String,

  media: [MediaSchema], // ✅ Now structured with all required fields

  likes: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  likedBy: [String], // List of usernames who liked
  comments: [CommentSchema] // ✅ Full comment structure preserved
}, { timestamps: true });

module.exports = mongoose.model('Post', PostSchema);
