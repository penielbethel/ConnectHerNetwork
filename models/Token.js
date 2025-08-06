const mongoose = require("mongoose");

const tokenSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  token: { type: String, required: true }
});

module.exports = mongoose.model("Token", tokenSchema);
