const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { uploadToCloudinary, deleteFromCloudinary } = require("../cloudinary"); // ✅ includes delete

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const UPLOAD_DIR = "uploads/";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ✅ Compress image using Sharp
async function compressImage(buffer, outputPath) {
  return sharp(buffer)
    .resize({ width: 600 })
    .jpeg({ quality: 60 })
    .toFile(outputPath);
}

// ✅ Compress video using FFmpeg
async function compressVideo(inputBuffer, outputPath) {
  const tempInputPath = path.join(UPLOAD_DIR, `input-${Date.now()}.mp4`);
  fs.writeFileSync(tempInputPath, inputBuffer);

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
}

// ✅ POST /api/upload — Accept and compress image/video uploads
router.post("/", upload.any(), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: "No files uploaded" });
  }

  const uploadedFiles = [];

  try {
    for (const file of req.files) {
      const originalExt = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, originalExt);
      const safeName = base.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const timestamp = Date.now();

      let outputExt = originalExt;
      let mime = file.mimetype;
      let outputName = `compressed-${safeName}-${timestamp}${originalExt}`;
      let outputPath = path.join(UPLOAD_DIR, outputName);

      // ✅ Compress images
      if (mime.startsWith("image/")) {
        outputExt = ".jpg";
        outputName = `compressed-${safeName}-${timestamp}${outputExt}`;
        outputPath = path.join(UPLOAD_DIR, outputName);
        await compressImage(file.buffer, outputPath);
        mime = "image/jpeg";

      // ✅ Compress videos
      } else if (mime.startsWith("video/")) {
        outputExt = ".mp4";
        outputName = `compressed-${safeName}-${timestamp}${outputExt}`;
        outputPath = path.join(UPLOAD_DIR, outputName);
        await compressVideo(file.buffer, outputPath);
        mime = "video/mp4";

      // ✅ Directly write raw files
      } else {
        outputPath = path.join(UPLOAD_DIR, outputName);
        fs.writeFileSync(outputPath, file.buffer);
      }

      // ✅ Determine upload folder
      let uploadFolder = "uploads"; // fallback
      const field = file.fieldname.toLowerCase();
      const name = file.originalname.toLowerCase();

      if (field === "avatar" || name.includes("avatar")) {
        uploadFolder = "uploads/avatars";
      } else if (field === "logo" || name.includes("logo")) {
        uploadFolder = "uploads/sponsor-logos";
      } else if (field === "media" || name.includes("media")) {
        uploadFolder = "uploads/sponsor-posts";
      }

      // ✅ Upload to Cloudinary
      const result = await uploadToCloudinary(outputPath, uploadFolder);

      // ✅ Delete local compressed file
      fs.unlinkSync(outputPath);

      // ✅ Delete old media if public_id was sent
      if (req.body.oldPublicId) {
        try {
          await deleteFromCloudinary(req.body.oldPublicId);
        } catch (err) {
          console.warn("⚠️ Failed to delete old Cloudinary file:", err.message);
        }
      }

      // ✅ Push result to response array
      uploadedFiles.push({
        name: file.originalname,
        url: result.url,
        public_id: result.public_id,
        type: mime
      });
    }

    return res.status(200).json({ success: true, files: uploadedFiles });
  } catch (err) {
    console.error("❌ Upload failed:", err);
    return res.status(500).json({ success: false, message: "Upload failed", error: err.message });
  }
});

module.exports = router;
