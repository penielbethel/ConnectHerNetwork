// routes/sponsors.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const nodemailer = require("nodemailer");
const { uploadToCloudinary, deleteFromCloudinary } = require("../cloudinary");

const Sponsor = require("../models/Sponsor");
const User = require("../models/User");
const Notification = require("../models/Notification");
const verifyTokenAndRole = require("../middleware/verifyTokenAndRole");

// Multer setup
const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });

// CORS
const cors = require("cors");
router.use(cors({
  origin: [
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
    "http://localhost:8080",
    "http://127.0.0.1",
    "https://connecther.network"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

/** ------------------------
 * Register a new sponsor
 * POST /api/sponsors/register
 * ------------------------ */
router.post("/register", verifyTokenAndRole(["admin", "superadmin"]), upload.single("logo"), async (req, res) => {
  try {
    const { companyName, objectives } = req.body;
    let logo = null, logoPublicId = null;

    if (req.file) {
      const outputPath = path.join("uploads", `compressed-${Date.now()}-${req.file.originalname}`);
      await sharp(req.file.buffer).resize({ width: 600 }).jpeg({ quality: 60 }).toFile(outputPath);
      const result = await uploadToCloudinary(outputPath, "uploads/sponsor-logos");
      logo = result.url;
      logoPublicId = result.public_id;
      fs.unlinkSync(outputPath);
    }

    const newSponsor = new Sponsor({ companyName, objectives, logo, logoPublicId, posts: [], postCount: 0 });
    await newSponsor.save();
    res.status(201).json({ success: true, message: "Sponsor registered successfully", sponsor: newSponsor });
  } catch (err) {
    console.error("Register Sponsor Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/** ------------------------
 * Get all sponsors
 * GET /api/sponsors
 * ------------------------ */
router.get("/", async (req, res) => {
  try {
    const sponsors = await Sponsor.find().sort({ createdAt: -1 });
    res.json(sponsors);
  } catch (err) {
    console.error("Get Sponsors Error:", err);
    res.status(500).json({ message: "Failed to load sponsors" });
  }
});

/** ------------------------
 * Add Post for Sponsor
 * PUT /api/sponsors/:id/post
 * ------------------------ */
router.put("/:id/post", verifyTokenAndRole(["admin","superadmin"]), upload.single("media"), async (req, res) => {
  try {
    const { caption, jobLink } = req.body;
    const sponsor = await Sponsor.findById(req.params.id);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    let media = null, mediaPublicId = null;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const isImage = req.file.mimetype.startsWith("image/");
      const isVideo = req.file.mimetype.startsWith("video/");
      const outputPath = path.join("uploads", `compressed-${Date.now()}-${req.file.originalname}`);

      if (isImage) await sharp(req.file.buffer).resize({ width: 600 }).jpeg({ quality: 60 }).toFile(outputPath);
      else if (isVideo) {
        const tempInput = path.join("uploads", `temp-${Date.now()}.mp4`);
        fs.writeFileSync(tempInput, req.file.buffer);
        await new Promise((resolve, reject) => {
          ffmpeg(tempInput).outputOptions("-crf 28").save(outputPath)
            .on("end", () => { fs.unlinkSync(tempInput); resolve(); })
            .on("error", (err) => { fs.unlinkSync(tempInput); reject(err); });
        });
      } else fs.writeFileSync(outputPath, req.file.buffer);

      const result = await uploadToCloudinary(outputPath, "uploads/sponsor-posts");
      media = result.url;
      mediaPublicId = result.public_id;
      fs.unlinkSync(outputPath);
    }

    const post = { caption: caption || "No caption", jobLink: jobLink || "#", media, mediaPublicId, views: 0, clicks: 0, createdAt: new Date() };
    sponsor.posts.push(post);
    sponsor.postCount = sponsor.posts.length;
    await sponsor.save();

    // Notification
    await Notification.create({
      type: "sponsor",
      title: "New Sponsorship Alert",
      content: `${sponsor.companyName} just posted a new sponsorship opportunity.`,
      sponsorId: sponsor._id,
      postId: post._id,
      createdAt: new Date(),
      forAll: true
    });

   // Emails
try {
  const users = await User.find({}, "email firstName surname username");

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // TLS
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  // ✅ Check if transporter is ready
  await transporter.verify();
  console.log("✅ Mail server ready to send emails");

  const BATCH_SIZE = 50;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (u) => {
        try {
          let info = await transporter.sendMail({
            from: `"ConnectHer Network" <${process.env.EMAIL_USERNAME}>`,
            to: u.email,
            subject: `📢 New Sponsorship from ${sponsor.companyName}`,
            html: `
              <div style="font-family: Arial, sans-serif; line-height:1.6; padding:10px; max-width:600px; margin:auto; border:1px solid #eee; border-radius:8px;">
                <h2 style="color:#e91e63;">New Sponsorship Alert from ConnectHer Mobile App</h2>
                <p>Hello <strong>${u.firstName || u.username || "User"}</strong>,</p>
                <p><strong>${sponsor.companyName}</strong> just posted a new sponsorship opportunity facilitated by ConnectHer Network.</p>

                ${sponsor.logo ? `<img src="${sponsor.logo}" alt="Sponsor Logo" style="width:80px; border-radius:50%; margin:10px 0;" />` : ""}

                <p style="font-size:15px; color:#333;">${caption || ""}</p>

                ${
                  media
                    ? `<div style="margin:15px 0;">
                         <img src="${media}" alt="Sponsor Media" style="width:100%; max-width:400px; border-radius:8px;" />
                       </div>`
                    : ""
                }

                <p>
                  <a href="${jobLink || "#"}" target="_blank" style="display:inline-block; background:#e91e63; color:#fff; padding:10px 15px; text-decoration:none; border-radius:5px;">
                    View Opportunity
                  </a>
                </p>

                <p style="margin-top:20px;">Please Login to the App to Enjoy this Benefit,<br><strong>Thank you, ConnectHer Network</strong></p>
              </div>
            `,
          });

          console.log(`📧 Sent to ${u.email}: ${info.messageId}`);
        } catch (err) {
          console.error(`❌ Failed to send to ${u.email}:`, err.message);
        }
      })
    );

    console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} finished`);
  }
} catch (err) {
  console.error("❌ Email block error:", err);
}




    res.status(200).json({ success: true, message: "Post added, notification & emails sent", sponsor });

  } catch (err) {
    console.error("Add Post Error:", err);
    res.status(500).json({ success: false, message: "Failed to add post", error: err.message });
  }
});

/** ------------------------
 * Edit Post for Sponsor
 * PUT /api/sponsors/:sponsorId/posts/:postId
 * ------------------------ */
router.put("/:sponsorId/posts/:postId", verifyTokenAndRole(["admin","superadmin"]), upload.single("media"), async (req,res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    const post = sponsor.posts.id(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (req.body.caption) post.caption = req.body.caption;
    if (req.body.jobLink) post.jobLink = req.body.jobLink;

    if (req.file) {
      // Delete old media
      if (post.mediaPublicId) await deleteFromCloudinary(post.mediaPublicId);

      let outputPath;
      const isImage = req.file.mimetype.startsWith("image/");
      const isVideo = req.file.mimetype.startsWith("video/");

      if (isImage) { outputPath = path.join("uploads", `compressed-${Date.now()}.jpeg`); await sharp(req.file.buffer).resize({ width: 600 }).jpeg({ quality: 60 }).toFile(outputPath); }
      else if (isVideo) { 
        const tempInput = path.join("uploads", `temp-${Date.now()}.mp4`);
        fs.writeFileSync(tempInput, req.file.buffer);
        outputPath = path.join("uploads", `compressed-${Date.now()}.mp4`);
        await new Promise((resolve,reject) => {
          ffmpeg(tempInput).outputOptions("-crf 28").save(outputPath)
          .on("end",()=>{fs.unlinkSync(tempInput); resolve();})
          .on("error",(err)=>{fs.unlinkSync(tempInput); reject(err);});
        });
      } else fs.writeFileSync(outputPath, req.file.buffer);

      const result = await uploadToCloudinary(outputPath, "uploads/sponsor-posts");
      post.media = result.url;
      post.mediaPublicId = result.public_id;
      fs.unlinkSync(outputPath);
    }

    await sponsor.save();
    res.json({ success: true, message: "Post updated successfully", post });
  } catch (err) {
    console.error("Edit Post Error:", err);
    res.status(500).json({ success: false, message: "Failed to update post", error: err.message });
  }
});

/** ------------------------
 * Delete a post
 * DELETE /api/sponsors/:sponsorId/posts/:postId
 * ------------------------ */
router.delete("/:sponsorId/posts/:postId", verifyTokenAndRole(["admin", "superadmin"]), async (req, res) => {
  try {
    const { sponsorId, postId } = req.params;

    const sponsor = await Sponsor.findById(sponsorId);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    const post = sponsor.posts.id(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    // Delete media from Cloudinary if exists
    if (post.mediaPublicId) {
      try {
        await deleteFromCloudinary(post.mediaPublicId);
      } catch (err) {
        console.warn("⚠️ Failed to delete media from Cloudinary:", err.message);
      }
    }

    // ✅ Correct way to remove subdocument
    sponsor.posts.pull(post._id);
    sponsor.postCount = sponsor.posts.length;
    await sponsor.save();

    res.json({ success: true, message: "✅ Post deleted successfully" });
  } catch (err) {
    console.error("❌ Delete Sponsor Post Error:", err);
    res.status(500).json({ success: false, message: "Failed to delete post", error: err.message });
  }
});


/** ------------------------
 * Delete a sponsor
 * DELETE /api/sponsors/:id
 * ------------------------ */
router.delete("/:id", verifyTokenAndRole(["admin","superadmin"]), async (req,res)=>{
  try {
    const sponsor = await Sponsor.findById(req.params.id);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    if (sponsor.logoPublicId) await deleteFromCloudinary(sponsor.logoPublicId);
    for (const post of sponsor.posts) if(post.mediaPublicId) await deleteFromCloudinary(post.mediaPublicId);

    await Sponsor.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Sponsor deleted successfully" });
  } catch(err){
    console.error("Delete Sponsor Error:", err);
    res.status(500).json({ success: false, message: "Failed to delete sponsor", error: err.message });
  }
});

/** ------------------------
 * Get all posts for a sponsor (PUBLIC)
 * GET /api/sponsors/:id/posts
 * ------------------------ */
router.get("/:id/posts", async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.id);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });
    res.json(sponsor.posts || []);
  } catch (err) {
    console.error("Fetch Sponsor Posts Error:", err);
    res.status(500).json({ message: "Failed to fetch posts", error: err.message });
  }
});


module.exports = router;
