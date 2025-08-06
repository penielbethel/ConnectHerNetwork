// 📦 Imports
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sharp = require("sharp");
const fs = require("fs");
const User = require("../models/User");
const nodemailer = require("nodemailer");
const { uploadToCloudinary, deleteFromCloudinary } = require("../cloudinary"); // root path

// 🖼️ Multer config (memory-based for Cloudinary)
const upload = multer({ storage: multer.memoryStorage() });


// 🔐 REGISTER USER
router.post("/register", upload.single("avatar"), async (req, res) => {
  try {
    const {
      firstName,
      surname,
      username,
      email,
      password,
      birthday,
      location,
      gender,
      adminToken
    } = req.body;

    // Password strength validation for regular users
    if (!adminToken) {
      const strongPasswordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;
      if (!strongPasswordRegex.test(password)) {
        return res.status(400).json({
          message: "Password must include at least one uppercase letter, one number, and one special character."
        });
      }
    }

    if (!req.file) {
      return res.status(400).json({ message: "Avatar is required." });
    }

    // ✅ Compress image to WebP in-memory then write to disk for upload
    const ext = path.extname(req.file.originalname).toLowerCase();
    const compressedName = req.file.originalname.replace(ext, "_compressed.webp");
    const outputPath = path.join("uploads", `${Date.now()}-${compressedName}`);

    await sharp(req.file.buffer, { limitInputPixels: false })
      .resize({ width: 400 })
      .webp({ quality: 70 })
      .toFile(outputPath);

    // ✅ Upload compressed avatar to Cloudinary
   const result = await uploadToCloudinary(outputPath, "uploads/avatars");

    // ✅ Remove local copy
    fs.unlink(outputPath, (err) => {
      if (err) console.warn("⚠️ Could not delete local avatar:", err);
    });

    const avatarUrl = result.url; // Cloudinary path: uploads/avatars/

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ message: "Username or email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Admin token check
    let role = "user";
    if (adminToken) {
      try {
        const decoded = jwt.verify(adminToken, process.env.JWT_SECRET || "FORam8n8ferans#1");
        if (decoded?.type === "invite" && ["admin", "superadmin"].includes(decoded.role)) {
          role = decoded.role;
        } else {
          return res.status(400).json({ message: "Invalid or expired admin invite token." });
        }
      } catch (err) {
        return res.status(400).json({ message: "Invalid or expired admin invite token." });
      }
    }

    const newUser = new User({
      firstName,
      surname,
      username,
      email,
      password: hashedPassword,
      birthday,
      location,
      gender: gender === "Other" ? "Other" : "Female",
      avatar: avatarUrl,
      avatarPublicId: result.public_id, // ✅ New: Track for deletion
      bio: "",
      category: "",
      website: "",
      workplace: "",
      education: "",
      dob: "",
      joined: new Date().toISOString().split("T")[0],
      role
    });

    await newUser.save();

    const { password: pwd, ...userWithoutPassword } = newUser._doc;
    res.status(201).json({
      message: "User registered successfully.",
      user: userWithoutPassword
    });

  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).json({ message: "Error registering user." });
  }
});



// 🔐 LOGIN USER + ISSUE JWT
router.post("/login", express.json(), async (req, res) => {
  try {
    const { identifier, password } = req.body;

    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Invalid password." });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 5 * 60 * 1000; // 5 mins

    // Save to user
    user.otpCode = otp;
    user.otpExpires = otpExpires;
    await user.save();

    // Send Email via Gmail
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Transport error:", error);
  } else {
    console.log("✅ Server is ready to send emails");
  }
});


    const mailOptions = {
      from: process.env.EMAIL_USERNAME,
      to: user.email,
      subject: "Your OTP Code for Login",
      text: `Your login OTP code is: ${otp}. It will expire in 5 minutes.`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("❌ Email error:", error);
        return res.status(500).json({ message: "Failed to send OTP email." });
      } else {
        return res.status(200).json({
          message: "OTP sent to your email.",
          step: "otp",
          userId: user._id
        });
      }
    });

  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Error logging in." });
  }
});


// VERIFY OTP
router.post("/verify-otp", express.json(), async (req, res) => {
  const { userId, otpCode } = req.body;
  

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    if (
      !user.otpCode ||
      user.otpCode !== otpCode ||
      Date.now() > user.otpExpires
    ) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    // Clear OTP
    user.otpCode = undefined;
    user.otpExpires = undefined;
    await user.save();

    // Issue token
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "3d" }
    );

    const { password: pwd, ...userWithoutPassword } = user._doc;

    res.status(200).json({
      message: "Login successful!",
      token,
      user: userWithoutPassword
    });

  } catch (err) {
    console.error("❌ OTP verification error:", err);
    res.status(500).json({ message: "Error verifying OTP." });
  }
});



// 📝 UPDATE PROFILE (unchanged, just kept for continuity)
router.put("/update", upload.single("avatar"), async (req, res) => {
  try {
    const {
      username,
      email,
      bio,
      category,
      location,
      website,
      workplace,
      education,
      dob,
      firstName,
      surname,
      name,
      joined
    } = req.body;

    if (!username) {
      return res.status(400).json({ message: "Username is required." });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

if (req.file) {
  const compressedName = req.file.originalname.replace(/\.[^/.]+$/, "_compressed.webp");
  const outputPath = path.join("uploads", `${Date.now()}-${compressedName}`);

  await sharp(req.file.buffer, { limitInputPixels: false })
    .resize({ width: 400 })
    .webp({ quality: 70 })
    .toFile(outputPath);

  // ✅ Remove old avatar from Cloudinary
  if (user.avatarPublicId) {
    try {
      await deleteFromCloudinary(user.avatarPublicId);
    } catch (err) {
      console.warn("⚠️ Failed to delete old avatar from Cloudinary:", err.message);
    }
  }

  const result = await uploadToCloudinary(outputPath, "uploads/avatars");
  fs.unlink(outputPath, () => {}); // delete local after upload

  user.avatar = result.url;
  user.avatarPublicId = result.public_id;
}



// ✅ Accept avatar from body if not using file upload
if (!req.file && req.body.avatar && req.body.avatar.startsWith("http")) {
  user.avatar = req.body.avatar;
}

    // Check for unique email
    if (email !== undefined && email !== user.email) {
    const emailExists = await User.findOne({ email });
    if (emailExists && emailExists._id.toString() !== user._id.toString()) {
    return res.status(400).json({ message: "Email already in use." });
    } user.email = email;}
    if (bio !== undefined) user.bio = bio;
    if (category !== undefined) user.category = category;
    if (location !== undefined) user.location = location;
    if (website !== undefined) user.website = website;
    if (workplace !== undefined) user.workplace = workplace;
    if (education !== undefined) user.education = education;
    if (dob !== undefined) user.dob = dob;
    if (firstName !== undefined) user.firstName = firstName;
    if (surname !== undefined) user.surname = surname;
    if (name !== undefined) user.name = name;
    if (joined !== undefined) user.joined = joined;
    if (joined !== undefined) user.markModified("joined");

    await user.save();
    const updated = await User.findOne({ username });
    const { password, ...userWithoutPassword } = updated._doc;

res.status(200).json({
  success: true,
  user: userWithoutPassword
});


  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ message: "Error updating profile." });
  }
});




// 📩 Forgot Password Route
router.post("/forgot-password", express.json(), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required." });

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: "User not found." });

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  user.resetCode = resetCode;
  user.resetCodeExpires = Date.now() + 15 * 60 * 1000; // 15 min

  await user.save();

  // Send Email via Gmail (or configure your own SMTP)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USERNAME, 
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: "ConnectHer Password Reset Code",
    text: `Your password reset code is: ${resetCode} (valid for 15 mins)`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("❌ Email error:", error);
      return res.status(500).json({ message: "Failed to send reset email." });
    } else {
      return res.status(200).json({ message: "Reset code sent successfully." });
    }
  });
});

// 🔁 Reset Password Route
router.post("/reset-password", express.json(), async (req, res) => {
  const { email, code, newPassword } = req.body;

  const user = await User.findOne({ email });
  if (!user || user.resetCode !== code || Date.now() > user.resetCodeExpires) {
    return res.status(400).json({ message: "Invalid or expired reset code." });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetCode = undefined;
  user.resetCodeExpires = undefined;

  await user.save();

  res.status(200).json({ message: "Password reset successful." });
});

// ✅ Save FCM Token for Push Notifications NEWMEK
router.post("/save-fcm-token", express.json(), async (req, res) => {
  const { username, token } = req.body;

  if (!username || !token) {
    return res.status(400).json({ success: false, message: "Username and token are required." });
  }

  try {
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (!user.fcmTokens) user.fcmTokens = [];

    if (!user.fcmTokens.includes(token)) {
      user.fcmTokens.push(token);
      await user.save();
    }

    res.json({ success: true, message: "FCM token saved successfully." });
  } catch (err) {
    console.error("❌ Error saving FCM token:", err);
    res.status(500).json({ success: false, message: "Failed to save FCM token." });
  }
});


module.exports = router;
