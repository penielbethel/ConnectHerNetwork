const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const Message = require('../models/Message');
const { uploadToCloudinary, deleteFromCloudinary } = require('../cloudinary'); // root-level import

// Use memory storage so we can work directly with buffers
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Ensure the uploads directory exists
const UPLOAD_DIR = "uploads/";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

/**
 * Compress an image using Sharp.
 * This resizes the image to width 1080 and converts it to WebP.
 */
async function compressImage(buffer, outputPath) {
  return sharp(buffer)
    .resize({ width: 1080 })
    .toFormat('webp')
    .webp({ quality: 70 })
    .toFile(outputPath);
}

/**
 * Compress a video using FFmpeg.
 * This writes a temporary input file in UPLOAD_DIR, compresses it using given options, and writes the output.
 */
async function compressVideo(inputBuffer, outputPath) {
  const tempInputPath = path.join(UPLOAD_DIR, `input-${Date.now()}.mp4`);
  fs.writeFileSync(tempInputPath, inputBuffer);
  
  return new Promise((resolve, reject) => {
    ffmpeg(tempInputPath)
      .outputOptions([
        '-vf scale=720:-1',
        '-crf 28',
        '-preset veryfast'
      ])
      .save(outputPath)
      .on('end', () => {
        fs.unlinkSync(tempInputPath);
        resolve();
      })
      .on('error', (err) => {
        fs.unlinkSync(tempInputPath);
        reject(err);
      });
  });
}

/**
 * POST: Save a new message with media (if provided)
 * For each media file:
 *   - If it’s an image, compress using Sharp.
 *   - If it’s a video, compress using FFmpeg.
 *   - Otherwise, write the file buffer directly.
 * Then upload the resulting file to Cloudinary and clean up the local file.
 */
router.post('/', upload.array('media', 10), async (req, res) => {
  const { sender, recipient, text = "", audio = "", reply = "", replyFrom = "", replyToId = "" } = req.body;
  const files = req.files || [];
  
  if (!sender || !recipient || (!text && !audio && files.length === 0)) {
    return res.status(400).json({ success: false, message: "Missing message content" });
  }
  
  const mediaArray = [];

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
    const timestamp = Date.now();
    const safeName = `${base}-${timestamp}`;
    let outputExt, outputName, outputPath, mime = file.mimetype;
    
    try {
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        // Compress image: resize to 1080 and convert to WebP
        outputExt = ".webp";
        outputName = `compressed-${safeName}${outputExt}`;
        outputPath = path.join(UPLOAD_DIR, outputName);
        await compressImage(file.buffer, outputPath);
        
      } else if (['.mp4', '.mov', '.webm'].includes(ext)) {
        // Compress video: scale to 720 and use CRF 28 with preset veryfast
        outputExt = ".mp4";
        outputName = `compressed-${safeName}${outputExt}`;
        outputPath = path.join(UPLOAD_DIR, outputName);
        await compressVideo(file.buffer, outputPath);
        
      } else {
        // For other file types, save directly without compression
        outputName = `compressed-${safeName}${ext}`;
        outputPath = path.join(UPLOAD_DIR, outputName);
        fs.writeFileSync(outputPath, file.buffer);
      }

      // Upload the (compressed) file to Cloudinary
      const result = await uploadToCloudinary(outputPath, "uploads");
      // Clean up the local file after upload
      fs.unlinkSync(outputPath);
      
      // Push as an object maintaining your media display structure
      mediaArray.push({
        name: file.originalname,
        url: result.url,
        public_id: result.public_id,
        type: mime
      });
    } catch (err) {
      console.error("Compression/upload error for file:", file.originalname, err);
      // On error, fallback to original file upload
      try {
        outputName = `fallback-${safeName}${ext}`;
        outputPath = path.join(UPLOAD_DIR, outputName);
        fs.writeFileSync(outputPath, file.buffer);
        const result = await uploadToCloudinary(outputPath, "uploads");
        fs.unlinkSync(outputPath);
        mediaArray.push({
          name: file.originalname,
          url: result.url,
          public_id: result.public_id,
          type: mime
        });
      } catch (fallbackErr) {
        console.error("Fallback upload failed:", fallbackErr);
      }
    }
  }
  try {
const message = new Message({
  sender,
  recipient,
  text,
  audio,
  media: mediaArray,
  reply,
  replyFrom,
  replyToId,
  timestamp: new Date(),
});

const saved = await message.save();
// ✅ Emit to both the conversation room AND recipient directly
const io = req.app.get("io");
const roomId = [sender, recipient].sort().join("_");
io.to(roomId).emit("newMessage", saved);        // for conversation.html
io.to(recipient).emit("newMessage", saved);     // for dashboard.html

res.json({ success: true, message: saved });
  } catch (err) {
    console.error("❌ Message save failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * GET: Retrieve messages between two users (sorted by timestamp ascending)
 */
router.get('/:sender/:recipient', async (req, res) => {
  const { sender, recipient } = req.params;
  try {
    const messages = await Message.find({
      $or: [
        { sender, recipient },
        { sender: recipient, recipient: sender }
      ],
      hiddenFrom: { $ne: sender }
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Failed to fetch messages:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

/**
 * PUT: Edit message text only (media editing not handled here)
 */
router.put('/:id/edit', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  try {
    const updated = await Message.findByIdAndUpdate(id, { text }, { new: true });
    if (!updated) return res.status(404).json({ success: false, message: "Message not found" });
    res.json({ success: true, message: updated });
  } catch (err) {
    console.error("❌ Edit failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * DELETE: Soft-delete message for a specific user ("delete for me")
 */
router.delete('/:id/delete-for-me/:username', async (req, res) => {
  const { id, username } = req.params;
  try {
    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });
    if (!message.hiddenFrom) message.hiddenFrom = [];
    if (!message.hiddenFrom.includes(username)) {
      message.hiddenFrom.push(username);
      await message.save();
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Delete-for-me error:", err);
    res.status(500).json({ success: false });
  }
});

/**
 * DELETE: Soft-delete for everyone:
 * Clears text, media, and audio.
 * Additionally, deletes each media file from Cloudinary.
 */
router.delete('/:id/delete-for-everyone', async (req, res) => {
  const { id } = req.params;
  try {
    // Retrieve the message to check for existing media
    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });
    
    // Delete each media from Cloudinary if it exists
    if (message.media && message.media.length > 0) {
      for (const mediaItem of message.media) {
        if (mediaItem.public_id) {
          await deleteFromCloudinary(mediaItem.public_id);
        }
      }
    }
    
    // Soft-delete: clear out media, text, and audio; mark as deleted
    const updated = await Message.findByIdAndUpdate(
      id,
      {
        text: "",
        media: [],
        audio: "",
        deleted: true
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Message not found" });
    
    // Emit via Socket.IO (if configured) to both users
    const io = req.app.get("io");
    const room = [updated.sender, updated.recipient].sort().join("_");
    io.to(room).emit("messageDeleted", { _id: updated._id, deleted: true });
  
    res.json({ success: true, message: updated });
  } catch (err) {
    console.error("❌ Delete-for-everyone error:", err);
    res.status(500).json({ success: false });
  }
});

/**
 * DELETE: Clear entire chat (soft delete for one user)
 */
router.delete('/clear/:username/:friend', async (req, res) => {
  const { username, friend } = req.params;
  try {
    const result = await Message.updateMany({
      $or: [
        { sender: username, recipient: friend },
        { sender: friend, recipient: username }
      ],
      hiddenFrom: { $ne: username }
    }, {
      $addToSet: { hiddenFrom: username }
    });
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) {
    console.error("❌ Failed to clear chat:", err);
    res.status(500).json({ success: false });
  }
});

/**
 * GET: Retrieve community messages for a given community ID (sorted by timestamp)
 */
router.get('/community/:communityId', async (req, res) => {
  const { communityId } = req.params;
  try {
    const messages = await Message.find({ recipient: communityId }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Failed to fetch community messages:", err);
    res.status(500).json({ error: "Failed to load community messages" });
  }
});

/**
 * GET: Retrieve the last message for each friend (with friend details enriched)
 */
const User = require('../models/User'); // ensuring User model is available
router.get('/latest/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const latestMessages = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: username },
            { recipient: username }
          ],
          hiddenFrom: { $ne: username }
        }
      },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { $cond: [{ $eq: ["$sender", username] }, "$recipient", "$sender"] },
          lastMessage: { $first: "$$ROOT" }
        }
      },
      {
        $project: {
          friend: "$_id",
          lastMessage: {
            _id: 1,
            text: 1,
            media: 1,
            audio: 1,
            reply: 1,
            replyFrom: 1,
            replyToId: 1,
            deleted: 1,
            timestamp: 1,
            sender: 1,
            recipient: 1
          }
        }
      }
    ]);
  
    // Populate friend details (name, avatar, etc.) for richer UI
    const enrichedResults = await Promise.all(latestMessages.map(async entry => {
      const friendUser = await User.findOne({ username: entry.friend })
        .select("name avatar username status")
        .lean();
      return { ...entry, friendDetails: friendUser || {} };
    }));
  
    res.json(enrichedResults);
  } catch (err) {
    console.error("❌ Failed to get last messages:", err);
    res.status(500).json({ error: "Failed to get latest messages." });
  }
});

module.exports = router;
