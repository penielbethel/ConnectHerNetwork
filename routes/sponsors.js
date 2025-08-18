// routes/sponsors.js
const express = require("express");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { uploadToCloudinary, deleteFromCloudinary } = require("../cloudinary");

const Sponsor = require("../models/Sponsor");
const verifyTokenAndRole = require("../middleware/verifyTokenAndRole");


const Notification = require("../models/Notification");
const User = require("../models/User"); // if sending to specific users

// File storage
const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });

// ✅ STEP 2: NEWMEK
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

/**
 * ✅ POST /api/sponsors/register
 * Register a sponsor
 */
router.post(
  "/register",
  verifyTokenAndRole(["admin", "superadmin"]),
  upload.single("logo"),
  async (req, res) => {
    try {
      const { companyName, objectives } = req.body;

      let logo = null;
      let logoPublicId = null;

      if (req.file) {
        const path = require("path");
        const fs = require("fs");
        const outputPath = path.join("uploads", `compressed-${Date.now()}-${req.file.originalname}`);

        // Compress the logo image
        await sharp(req.file.buffer)
          .resize({ width: 600 })
          .jpeg({ quality: 60 })
          .toFile(outputPath);

        // Upload to Cloudinary
        const { url, public_id } = await uploadToCloudinary(outputPath, "uploads/sponsor-logos");

        // Clean up local file
        fs.unlinkSync(outputPath);

        logo = url;
        logoPublicId = public_id;
      }

      const newSponsor = new Sponsor({
        companyName,
        objectives,
        logo,
        logoPublicId,
        posts: [],
        postCount: 0
      });

      await newSponsor.save();
      res.status(201).json({ message: "Sponsor registered successfully", sponsor: newSponsor });

    } catch (err) {
      console.error("Register Sponsor Error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);


// ✅ Allow both App (no token) and Web (tokened users)
router.get("/", async (req, res) => {
  try {
    const sponsors = await Sponsor.find().sort({ createdAt: -1 });
    res.json(sponsors);
  } catch (err) {
    console.error("Get Sponsors Error:", err);
    res.status(500).json({ message: "Failed to load sponsors" });
  }
});



// PUT /api/sponsors/:id/post - Add post and notify users
router.put(
  "/:id/post",
  verifyTokenAndRole(["admin", "superadmin"]),
  upload.single("media"),
  async (req, res) => {
    try {
      const { caption, jobLink } = req.body;

      let media = null;
      let mediaPublicId = null;

      // Compress + Upload to Cloudinary
      if (req.file) {
        try {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const isImage = req.file.mimetype.startsWith("image/");
          const isVideo = req.file.mimetype.startsWith("video/");
          const outputName = `compressed-${Date.now()}-${req.file.originalname}`;
          const outputPath = path.join("uploads", outputName);

          if (isImage) {
            await sharp(req.file.buffer)
              .resize({ width: 600 })
              .jpeg({ quality: 60 })
              .toFile(outputPath);
          } else if (isVideo) {
            const tempInputPath = path.join("uploads", `temp-${Date.now()}.mp4`);
            fs.writeFileSync(tempInputPath, req.file.buffer);
            await new Promise((resolve, reject) => {
              ffmpeg(tempInputPath)
                .outputOptions("-crf 28")
                .save(outputPath)
                .on("end", () => {
                  fs.unlinkSync(tempInputPath);
                  resolve();
                })
                .on("error", (err) => {
                  fs.unlinkSync(tempInputPath);
                  reject(err);
                });
            });
          } else {
            fs.writeFileSync(outputPath, req.file.buffer);
          }

          const result = await uploadToCloudinary(outputPath, "uploads/sponsor-posts");
          media = result.url;
          mediaPublicId = result.public_id;
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.error("⚠️ Media upload failed:", err);
        }
      }

      const sponsor = await Sponsor.findById(req.params.id);
      if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

      const post = {
        caption,
        jobLink,
        media,
        mediaPublicId,
        views: 0,
        clicks: 0,
        createdAt: new Date(),
      };

      sponsor.posts.push(post);
      sponsor.postCount = sponsor.posts.length;
      await sponsor.save();

      // Create a notification
      await Notification.create({
        type: "sponsor",
        title: "New Sponsorship Alert",
        content: `${sponsor.companyName} just posted a new sponsorship opportunity.`,
        sponsorId: sponsor._id,
        postId: post._id,
        createdAt: new Date(),
        forAll: true,
      });

      // Send emails to all users (wrapped in try/catch)
      try {
        const users = await User.find({}, "email username");
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USERNAME,
            pass: process.env.EMAIL_PASSWORD,
          }
        });

        const BATCH_SIZE = 50;
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
          const batch = users.slice(i, i + BATCH_SIZE);
          const emailPromises = batch.map(user => {
            const mailOptions = {
              from: process.env.EMAIL_USERNAME,
              to: user.email,
              subject: `New Sponsorship from ${sponsor.companyName}`,
              html: `
                <p>Hello ${user.username || "User"},</p>
                <p><strong>${sponsor.companyName}</strong> just posted a new sponsorship opportunity:</p>
                <p>${caption || ""}</p>
                ${media ? `<img src="${media}" alt="Sponsor Media" style="width:100%;max-width:400px;border-radius:8px;" />` : ""}
                <p><a href="${jobLink || "#"}" target="_blank">View Opportunity</a></p>
                <p>Thank you for using ConnectHer Network!</p>
              `
            };
            return transporter.sendMail(mailOptions);
          });
          await Promise.allSettled(emailPromises);
          console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} of emails sent`);
        }
      } catch (err) {
        console.error("⚠️ Failed to send emails:", err);
      }

      res.status(200).json({ message: "Post added, notification created, emails sent (if possible)", sponsor });

    } catch (err) {
      console.error("❌ Post for Sponsor Error:", err);
      res.status(500).json({ message: "Failed to add post", error: err.message });
    }
  }
);

// DELETE /api/sponsors/:sponsorId/posts/:postId
router.delete("/:sponsorId/posts/:postId", verifyTokenAndRole(["admin", "superadmin"]), async (req, res) => {
  try {
    const { sponsorId, postId } = req.params;

    const sponsor = await Sponsor.findById(sponsorId);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    const post = sponsor.posts.id(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (post.mediaPublicId) {
      try {
        await deleteFromCloudinary(post.mediaPublicId);
      } catch (err) {
        console.warn("⚠️ Failed to delete media from Cloudinary:", err.message);
      }
    }

    post.remove();
    sponsor.postCount = sponsor.posts.length;
    await sponsor.save();

    res.json({ message: "✅ Post deleted successfully" });
  } catch (err) {
    console.error("❌ Delete Sponsor Post Error:", err);
    res.status(500).json({ message: "Failed to delete post", error: err.message });
  }
});




// GET /api/sponsors/:id/posts
router.get("/:id/posts", verifyTokenAndRole(["user","admin", "superadmin"]), async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.id);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    res.json(sponsor.posts || []);
  } catch (err) {
    console.error("Fetch Sponsor Posts Error:", err);
    res.status(500).json({ message: "Failed to fetch posts." });
  }
});


// PUT /api/sponsors/:sponsorId/posts/:postId
router.put("/:sponsorId/posts/:postId", verifyTokenAndRole(["admin", "superadmin"]), upload.single("media"), async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

    const post = sponsor.posts.id(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    if (req.body.caption) post.caption = req.body.caption;
    if (req.body.jobLink) post.jobLink = req.body.jobLink;
    if (req.file) post.media = `https://connecther.network/uploads/${req.file.filename}`;

    await sponsor.save();
    res.json({ message: "Post updated", post });
  } catch (err) {
    console.error("Update Sponsor Post Error:", err);
    res.status(500).json({ message: "Failed to update post." });
  }
});


//COMPRESSION NEWMEK
const compressImage = async (buffer, outputPath) =>
  sharp(buffer).resize({ width: 600 }).jpeg({ quality: 60 }).toFile(outputPath);

const compressVideo = async (buffer, outputPath) => {
  const tempInputPath = path.join("uploads", `input-${Date.now()}.mp4`);
  fs.writeFileSync(tempInputPath, buffer);

  return new Promise((resolve, reject) => {
    ffmpeg(tempInputPath)
      .outputOptions("-crf 28")
      .save(outputPath)
      .on("end", () => {
        fs.unlinkSync(tempInputPath);
        resolve();
      })
      .on("error", (err) => {
        fs.unlinkSync(tempInputPath);
        reject(err);
      });
  });
};


// GET /api/sponsors/:sponsorId/posts/:postId/view
router.get("/:sponsorId/posts/:postId/view", async (req, res) => {
  const sponsor = await Sponsor.findById(req.params.sponsorId);
  if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

  const post = sponsor.posts.id(req.params.postId);
  if (!post) return res.status(404).json({ message: "Post not found" });

  post.views = (post.views || 0) + 1;
  await sponsor.save();

  res.json({ message: "View counted" });
});


// GET /redirect/:sponsorId/:postId
router.get("/redirect/:sponsorId/:postId", async (req, res) => {
  const sponsor = await Sponsor.findById(req.params.sponsorId);
  if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

  const post = sponsor.posts.id(req.params.postId);
  if (!post) return res.status(404).json({ message: "Post not found" });

  post.clicks = (post.clicks || 0) + 1;
  await sponsor.save();

  res.redirect(post.jobLink || "/");
});

// DELETE /api/sponsors/:id - Delete a sponsor
router.delete("/:id", verifyTokenAndRole(["admin", "superadmin"]), async (req, res) => {
  try {
const sponsor = await Sponsor.findById(req.params.id);
if (!sponsor) return res.status(404).json({ message: "Sponsor not found" });

// ✅ Delete sponsor logo from Cloudinary
if (sponsor.logoPublicId) {
  try {
    await deleteFromCloudinary(sponsor.logoPublicId);
  } catch (err) {
    console.warn("⚠️ Failed to delete sponsor logo from Cloudinary:", err.message);
  }
}

// ✅ Delete each sponsor post media from Cloudinary
for (const post of sponsor.posts) {
  if (post.mediaPublicId) {
    try {
      await deleteFromCloudinary(post.mediaPublicId);
    } catch (err) {
      console.warn(`⚠️ Failed to delete media (${post.mediaPublicId}) from Cloudinary:`, err.message);
    }
  }
}

// ✅ Delete sponsor from DB
await Sponsor.findByIdAndDelete(req.params.id);
res.json({ message: "Sponsor deleted successfully" });


  } catch (err) {
    console.error("Delete Sponsor Error:", err);
    res.status(500).json({ message: "Failed to delete sponsor" });
  }
});





module.exports = router;
