const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Sponsor = require("../models/Sponsor");
const verifyTokenAndRole = require("../middleware/verifyTokenAndRole");

// Get total number of users
router.get("/users/count", verifyTokenAndRole(["admin", "superadmin"]), async (req, res) => {
  try {
    const count = await User.countDocuments({});
    res.json({ count });
  } catch (err) {
    console.error("User Count Error:", err);
    res.status(500).json({ message: "Failed to retrieve user count." });
  }
});

// 🔁 Increment views
router.post("/post/:sponsorId/:postId/view", async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    const post = sponsor?.posts.id(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    post.views += 1;
    await sponsor.save();
    res.json({ message: "View recorded" });
  } catch (err) {
    console.error("View Analytics Error:", err);
    res.status(500).json({ message: "Failed to record view" });
  }
});

// 🔗 Increment clicks
router.post("/post/:sponsorId/:postId/click", async (req, res) => {
  try {
    const sponsor = await Sponsor.findById(req.params.sponsorId);
    const post = sponsor?.posts.id(req.params.postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    post.clicks += 1;
    await sponsor.save();
    res.json({ message: "Click recorded" });
  } catch (err) {
    console.error("Click Analytics Error:", err);
    res.status(500).json({ message: "Failed to record click" });
  }
});

// 📊 Generate User Statistics/Analytics (Only for SuperAdmins)
router.get("/user-analytics", verifyTokenAndRole(["superadmin"]), async (req, res) => {
  try {
    // Get all users (excluding sensitive data)
    const users = await User.find({}, {
      location: 1,
      birthday: 1,
      dob: 1,
      gender: 1,
      joined: 1,
      createdAt: 1,
      _id: 1
    });

    const totalUsers = users.length;
    
    // Calculate age from birthday or dob
    const calculateAge = (birthDate) => {
      if (!birthDate) return null;
      const today = new Date();
      const birth = new Date(birthDate);
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      return age;
    };

    // Location Statistics
    const locationStats = {};
    users.forEach(user => {
      let location = user.location || "Unknown";
      
      // Normalize and organize major countries
      location = location.trim();
      if (location.toLowerCase().includes('nigeria') || location.toLowerCase().includes('ng')) {
        location = "Nigeria";
      } else if (location.toLowerCase().includes('usa') || location.toLowerCase().includes('united states') || location.toLowerCase().includes('america')) {
        location = "USA";
      } else if (location.toLowerCase().includes('uk') || location.toLowerCase().includes('united kingdom') || location.toLowerCase().includes('britain')) {
        location = "United Kingdom";
      } else if (location.toLowerCase().includes('canada')) {
        location = "Canada";
      } else if (location.toLowerCase().includes('ghana')) {
        location = "Ghana";
      } else if (location.toLowerCase().includes('south africa')) {
        location = "South Africa";
      } else if (location.toLowerCase().includes('kenya')) {
        location = "Kenya";
      } else if (location.toLowerCase().includes('india')) {
        location = "India";
      } else if (location.toLowerCase().includes('australia')) {
        location = "Australia";
      } else if (location.toLowerCase().includes('germany')) {
        location = "Germany";
      } else if (location.toLowerCase().includes('france')) {
        location = "France";
      } else if (location === "" || location.toLowerCase() === "unknown") {
        location = "Unknown";
      }
      
      locationStats[location] = (locationStats[location] || 0) + 1;
    });

    // Sort locations by count (descending) for better presentation
    const sortedLocationStats = Object.entries(locationStats)
      .sort(([,a], [,b]) => b - a)
      .reduce((sorted, [key, value]) => {
        sorted[key] = value;
        return sorted;
      }, {});

    const locationPercentages = {};
    Object.keys(sortedLocationStats).forEach(location => {
      locationPercentages[location] = {
        count: sortedLocationStats[location],
        percentage: ((sortedLocationStats[location] / totalUsers) * 100).toFixed(2)
      };
    });

    // Age Range Statistics
    const ageRanges = {
      "Under 18": 0,
      "18-24": 0,
      "25-34": 0,
      "35-44": 0,
      "45-54": 0,
      "55-64": 0,
      "65+": 0,
      "Unknown": 0
    };

    users.forEach(user => {
      const age = calculateAge(user.birthday || user.dob);
      if (age === null) {
        ageRanges["Unknown"]++;
      } else if (age < 18) {
        ageRanges["Under 18"]++;
      } else if (age >= 18 && age <= 24) {
        ageRanges["18-24"]++;
      } else if (age >= 25 && age <= 34) {
        ageRanges["25-34"]++;
      } else if (age >= 35 && age <= 44) {
        ageRanges["35-44"]++;
      } else if (age >= 45 && age <= 54) {
        ageRanges["45-54"]++;
      } else if (age >= 55 && age <= 64) {
        ageRanges["55-64"]++;
      } else {
        ageRanges["65+"]++;
      }
    });

    const ageRangePercentages = {};
    Object.keys(ageRanges).forEach(range => {
      ageRangePercentages[range] = {
        count: ageRanges[range],
        percentage: ((ageRanges[range] / totalUsers) * 100).toFixed(2)
      };
    });

    // Gender Statistics
    const genderStats = {};
    users.forEach(user => {
      const gender = user.gender || "Unknown";
      genderStats[gender] = (genderStats[gender] || 0) + 1;
    });

    const genderPercentages = {};
    Object.keys(genderStats).forEach(gender => {
      genderPercentages[gender] = {
        count: genderStats[gender],
        percentage: ((genderStats[gender] / totalUsers) * 100).toFixed(2)
      };
    });

    // Registration Timeline (by month)
    const registrationTimeline = {};
    users.forEach(user => {
      const joinDate = user.joined || (user.createdAt ? user.createdAt.toISOString().split("T")[0] : null);
      if (joinDate) {
        const monthYear = joinDate.substring(0, 7); // YYYY-MM format
        registrationTimeline[monthYear] = (registrationTimeline[monthYear] || 0) + 1;
      }
    });

    const analytics = {
      totalUsers,
      generatedAt: new Date().toISOString(),
      locationStatistics: locationPercentages,
      ageRangeStatistics: ageRangePercentages,
      genderStatistics: genderPercentages,
      registrationTimeline: Object.keys(registrationTimeline)
        .sort()
        .reduce((sorted, key) => {
          sorted[key] = registrationTimeline[key];
          return sorted;
        }, {})
    };

    res.json({ success: true, analytics });
  } catch (err) {
    console.error("User Analytics Error:", err);
    res.status(500).json({ success: false, message: "Failed to generate user analytics." });
  }
});

module.exports = router;
