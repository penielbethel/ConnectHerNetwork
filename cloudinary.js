// utils/cloudinary.js
const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload a file to Cloudinary
 * @param {string} filePath - Local path to file
 * @param {string} folder - Cloudinary folder path
 * @returns {Promise<{ url: string, public_id: string }>}
 */
const uploadToCloudinary = (filePath, folder = 'uploads') => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      { resource_type: 'auto', folder },
      (err, result) => {
        if (err || !result) {
          console.error("📛 Cloudinary upload error:", err || "No result");
          return reject(new Error("Cloudinary Upload Failed: " + (err?.message || "Unknown error")));
        }
        resolve({
          url: result.secure_url,
          public_id: result.public_id
        });
      }
    );
  });
};

/**
 * Delete a file from Cloudinary
 * @param {string} publicId - Cloudinary public ID of the file
 * @returns {Promise<void>}
 */
const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw'
    });
  } catch (error) {
    throw new Error('Cloudinary Deletion Failed: ' + error.message);
  }
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary
};
