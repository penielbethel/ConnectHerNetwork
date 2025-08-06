const jwt = require("jsonwebtoken");
const User = require("../models/User");

const SECRET = process.env.JWT_SECRET || "FORam8n8ferans#1";

function verifyTokenAndRole(allowedRoles = []) {
  return async function (req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Access token missing" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, SECRET);
      console.log("✅ Decoded token:", decoded); // Helpful for debugging

      const user = await User.findById(decoded.id);
      if (!user) {
        console.warn("❌ User not found for decoded ID:", decoded.id);
        return res.status(401).json({ message: "User not found" });
      }

      if (!allowedRoles.includes(user.role)) {
        console.warn("⛔ Access denied: role", user.role, "not in", allowedRoles);
        return res.status(403).json({ message: "Insufficient permissions" });
      }

      req.user = user; // Pass along user to routes
      next();

    } catch (err) {
      console.error("❌ Token verification error:", err.message);
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };
}

module.exports = verifyTokenAndRole;
