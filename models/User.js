const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  surname: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  birthday: { type: String },
  location: { type: String },
  avatar: { type: String, required: true },
  gender: { type: String, enum: ["Female", "Company"], default: "Female" },
  role: { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user' },
  lastSeen: { type: Date, default: Date.now },

  // ✅ Push Notification Tokens
  fcmTokens: [String],  // <-- 🔥 added field for FCM token(s)

  // 🧠 Extra Profile Info
  bio: { type: String },
  category: { type: String },
  website: { type: String },
  workplace: { type: String },
  education: { type: String },
  dob: { type: String },
  joined: { type: String },
  name: { type: String },

  // 🔐 For password reset
  resetCode: { type: String },
  resetCodeExpires: { type: Date },

  // 🔐 OTP fields for login
  otpCode: { type: String },
  otpExpires: { type: Date }

}, {
  timestamps: true
});

module.exports = mongoose.model("User", userSchema);
