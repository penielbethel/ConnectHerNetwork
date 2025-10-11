const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const CommunityMessage = require('../models/CommunityMessage');
const Community = require('../models/Community');
const { uploadToCloudinary, deleteFromCloudinary } = require('../cloudinary');
const { io } = require('../server');

const UPLOAD_DIR = 'uploads/';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`;
    cb(null, filename);
  }
});
const upload = multer({ storage });

// ✅ Compress image
const compressImage = async (inputPath, outputPath) => {
  await sharp(inputPath)
    .resize({ width: 1080 })
    .toFormat('webp')
    .webp({ quality: 70 })
    .toFile(outputPath);
  fs.unlinkSync(inputPath);
};

// ✅ Compress video
const compressVideo = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vf scale=720:-1', '-crf 28', '-preset veryfast'])
      .output(outputPath)
      .on('end', () => {
        fs.unlinkSync(inputPath);
        resolve();
      })
      .on('error', err => reject(err))
      .run();
  });
};

// ✅ POST a new message
router.post('/:id/messages', upload.any(), async (req, res) => {
  try {
    const { sender, text, replyTo, time } = req.body;
    const communityId = req.params.id;

    let media = [];
    if (req.body.media) {
      try {
        media = JSON.parse(req.body.media);
      } catch {
        return res.status(400).json({ success: false, message: "Invalid media format" });
      }
    }

    const files = req.files || [];
    const uploadedMedia = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const baseName = path.basename(file.originalname, ext);
      const safeName = baseName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const timestamp = Date.now();
      const compressedName = `compressed-${safeName}-${timestamp}${ext}`;
      const compressedPath = path.join(UPLOAD_DIR, compressedName);

      try {
        let resourceType = 'raw';

        if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          await compressImage(file.path, compressedPath);
          resourceType = 'image';

        } else if (['.mp4', '.mov', '.webm'].includes(ext)) {
          await compressVideo(file.path, compressedPath);
          resourceType = 'video';

        } else {
          fs.renameSync(file.path, compressedPath);
        }

        const result = await uploadToCloudinary(compressedPath, 'community', resourceType);
        fs.unlinkSync(compressedPath);

        uploadedMedia.push({
          name: file.originalname,
          type: resourceType,
          url: result.url,
          public_id: result.public_id,
          caption: ''
        });

      } catch (err) {
        console.error("❌ Compression or upload error:", err);
        uploadedMedia.push({
          name: file.originalname,
          type: 'unknown',
          url: '',
          public_id: null,
          caption: ''
        });
      }
    }

    const finalMedia = [...media, ...uploadedMedia];

    const newMsg = new CommunityMessage({
      communityId,
      sender: typeof sender === 'string' ? JSON.parse(sender) : sender,
      text,
      media: finalMedia,
      replyTo,
      time
    });

    await newMsg.save();
    // Emit to all users in the room (for those inside community.html)
io.to(communityId).emit("community-message", newMsg);

// ALSO emit to each member personally (for badge count in dashboard.html)
try {
  const community = await Community.findById(communityId);

  if (community && community.members?.length) {
    community.members.forEach(member => {
      if (member !== newMsg.sender.username) {
        io.to(member).emit("community-message", newMsg); // dashboard users will receive it
      }
    });
  }
} catch (err) {
  console.error("❌ Failed to emit to community members:", err);
}


    res.status(201).json({ success: true, message: newMsg });

  } catch (err) {
    console.error("❌ Error saving message:", err);
    res.status(500).json({ success: false, message: "Failed to save message." });
  }
});





// ✅ GET: Fetch messages
router.get('/:id/messages', async (req, res) => {
  try {
    const communityId = req.params.id;
    const username = req.query.username;

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required" });
    }

    const messages = await CommunityMessage.find({
      communityId,
      hiddenFrom: { $ne: username }
    }).sort({ time: 1 });

    res.json({ success: true, messages });
  } catch (err) {
    console.error("❌ Error fetching community messages:", err);
    res.status(500).json({ success: false, message: "Failed to fetch messages." });
  }
});


// ✅ Clear chat (soft delete for user)
router.post('/:id/clear', async (req, res) => {
  try {
    const communityId = req.params.id;
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: "Username is required" });
    }

    await CommunityMessage.updateMany(
      { communityId, hiddenFrom: { $ne: username } },
      { $push: { hiddenFrom: username } }
    );

    res.json({ success: true, message: "Chat cleared for user" });
  } catch (err) {
    console.error("❌ Failed to clear chat for user:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ✅ DELETE a message
router.delete('/:id/messages/:msgId', async (req, res) => {
  try {
    const { id: communityId, msgId } = req.params;
    const { username } = req.body;

    if (!username) return res.status(400).json({ success: false, message: "Username required." });

    const community = await Community.findById(communityId);
    const message = await CommunityMessage.findById(msgId);

    if (!community || !message)
      return res.status(404).json({ success: false, message: "Community or message not found." });

    const isSender = message.sender.username === username;
    const isAdmin = community.admins.includes(username) || community.creator === username;

    if (!isSender && !isAdmin)
      return res.status(403).json({ success: false, message: "Not authorized." });

    // ✅ Delete associated Cloudinary media
    for (const item of message.media || []) {
      if (item.public_id) {
        try {
          await deleteFromCloudinary(item.public_id);
        } catch (err) {
          console.warn("⚠️ Failed to delete from Cloudinary:", item.public_id);
        }
      }
    }

    await CommunityMessage.findByIdAndDelete(msgId);
    res.json({ success: true, message: "Message deleted." });

  } catch (err) {
    console.error("❌ Error deleting message:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});



// ✅ PATCH: Edit message
router.patch('/:id/messages/:msgId', async (req, res) => {
  try {
    const { text } = req.body;
    const updated = await CommunityMessage.findByIdAndUpdate(
      req.params.msgId,
      { text },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Message not found" });
    res.json({ success: true, message: updated });
  } catch (err) {
    console.error("❌ Failed to edit message:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ✅ PATCH alt edit route
router.patch('/:communityId/messages/:messageId', async (req, res) => {
  try {
    const { communityId, messageId } = req.params;
    const { newText } = req.body;

    if (!newText)
      return res.status(400).json({ success: false, message: "No new text provided" });

    const updated = await CommunityMessage.findOneAndUpdate(
      { _id: messageId, communityId },
      { $set: { text: newText + " (edited)" } },
      { new: true }
    );

    if (!updated)
      return res.status(404).json({ success: false, message: "Message not found" });

    res.json({ success: true, message: updated });

  } catch (err) {
    console.error("❌ Error editing message:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ✅ DELETE all messages in community
router.delete('/:id/messages/clear', async (req, res) => {
  try {
    const { id: communityId } = req.params;
    const messages = await CommunityMessage.find({ communityId });

    for (const message of messages) {
      for (const media of message.media || []) {
        if (media.public_id) {
          try {
            await deleteFromCloudinary(media.public_id);
          } catch (err) {
            console.warn("⚠️ Failed to delete:", media.public_id);
          }
        }
      }
    }

    await CommunityMessage.deleteMany({ communityId });
    res.json({ success: true, message: "All messages cleared for this community." });

  } catch (err) {
    console.error("❌ Error clearing messages:", err);
    res.status(500).json({ success: false, message: "Failed to clear messages." });
  }
});

module.exports = router;
