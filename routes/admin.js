// routes/admin.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const verifyTokenAndRole = require("../middleware/verifyTokenAndRole");
// Optional PDF export support (install: npm install pdfkit)
let PDFDocument;
try {
  PDFDocument = require("pdfkit");
} catch (e) {
  console.warn("pdfkit not installed; /admin/analytics.pdf disabled until installed.");
}

const SECRET = process.env.JWT_SECRET || "FORam8n8ferans#1";

// 🔐 Generate Invite Token (Only for SuperAdmins)
router.post("/generate-invite", verifyTokenAndRole(["superadmin"]), (req, res) => {
  const { role } = req.body;
  if (!role || !["admin", "superadmin"].includes(role)) {
    return res.status(400).json({ success: false, message: "Invalid role." });
  }

  const inviteToken = jwt.sign({ role, type: "invite" }, SECRET, { expiresIn: "2h" });
  res.json({ success: true, inviteToken });
});

// 🧑 Promote a user to admin (Only for SuperAdmins)
router.post("/promote/:username", verifyTokenAndRole(["superadmin"]), async (req, res) => {
  const { username } = req.params;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    user.role = "admin";
    await user.save();

    res.json({ success: true, message: `${username} promoted to admin.` });
  } catch (err) {
    console.error("Error promoting user:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// 👥 List all users (Only for SuperAdmins)
router.get("/users", verifyTokenAndRole(["superadmin"]), async (req, res) => {
  try {
    const users = await User.find({}, "username email role").sort({ username: 1 });
    res.json({ users });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: "Error retrieving users" });
  }
});

// 🔻 Demote an admin back to user (SuperAdmin only)
router.post("/demote/:username", verifyTokenAndRole(["superadmin"]), async (req, res) => {
  const { username } = req.params;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (user.role !== "admin") {
      return res.status(400).json({ success: false, message: `${username} is not an admin.` });
    }

    user.role = "user";
    await user.save();

    res.json({ success: true, message: `${username} has been demoted to user.` });
  } catch (err) {
    console.error("Error demoting user:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// 📊 Generate Analytics/Statistics (SuperAdmin only)
router.get('/analytics', verifyTokenAndRole(['superadmin']), async (req, res) => {
  console.log('🔍 Analytics endpoint called!');
  
  try {
    const users = await User.find({});
    const totalUsers = users.length;
    
    console.log('📊 Total users found:', totalUsers);

    if (totalUsers === 0) {
      console.log('⚠️ No users found, returning empty stats');
      return res.json({
        totalUsers: 0,
        countryStats: {},
        ageRangeStats: {},
        genderStats: {},
        roleStats: {},
        registrationTrends: {}
      });
    }

    // Country Statistics - Map locations to countries
    const countryCounts = {};
    
    // Comprehensive location-to-country mapping
    const locationToCountryMap = {
      // Nigeria
      'nigeria': 'Nigeria',
      'abuja': 'Nigeria',
      'fct': 'Nigeria',
      'lagos': 'Nigeria',
      'kano': 'Nigeria',
      'ibadan': 'Nigeria',
      'benin city': 'Nigeria',
      'port harcourt': 'Nigeria',
      'jos': 'Nigeria',
      'ilorin': 'Nigeria',
      'aba': 'Nigeria',
      'onitsha': 'Nigeria',
      'warri': 'Nigeria',
      'sokoto': 'Nigeria',
      'calabar': 'Nigeria',
      'enugu': 'Nigeria',
      'abeokuta': 'Nigeria',
      'akure': 'Nigeria',
      'bauchi': 'Nigeria',
      'gombe': 'Nigeria',
      'kaduna': 'Nigeria',
      'katsina': 'Nigeria',
      'kebbi': 'Nigeria',
      'maiduguri': 'Nigeria',
      'minna': 'Nigeria',
      'osogbo': 'Nigeria',
      'owerri': 'Nigeria',
      'umuahia': 'Nigeria',
      'uyo': 'Nigeria',
      'yenagoa': 'Nigeria',
      'yola': 'Nigeria',
      'zamfara': 'Nigeria',
      'plateau': 'Nigeria',
      'rivers': 'Nigeria',
      'cross river': 'Nigeria',
      'delta': 'Nigeria',
      'edo': 'Nigeria',
      'ogun': 'Nigeria',
      'ondo': 'Nigeria',
      'osun': 'Nigeria',
      'oyo': 'Nigeria',
      'ekiti': 'Nigeria',
      'kwara': 'Nigeria',
      'kogi': 'Nigeria',
      'benue': 'Nigeria',
      'nasarawa': 'Nigeria',
      'taraba': 'Nigeria',
      'adamawa': 'Nigeria',
      'borno': 'Nigeria',
      'yobe': 'Nigeria',
      'jigawa': 'Nigeria',
      'gombe': 'Nigeria',
      'bauchi': 'Nigeria',
      
      // South Africa
      'south africa': 'South Africa',
      'cape town': 'South Africa',
      'johannesburg': 'South Africa',
      'durban': 'South Africa',
      'pretoria': 'South Africa',
      'port elizabeth': 'South Africa',
      'bloemfontein': 'South Africa',
      'east london': 'South Africa',
      'pietermaritzburg': 'South Africa',
      'kimberley': 'South Africa',
      'polokwane': 'South Africa',
      'nelspruit': 'South Africa',
      'mafikeng': 'South Africa',
      'western cape': 'South Africa',
      'eastern cape': 'South Africa',
      'northern cape': 'South Africa',
      'free state': 'South Africa',
      'kwazulu-natal': 'South Africa',
      'north west': 'South Africa',
      'gauteng': 'South Africa',
      'mpumalanga': 'South Africa',
      'limpopo': 'South Africa',
      
      // Ghana
      'ghana': 'Ghana',
      'accra': 'Ghana',
      'kumasi': 'Ghana',
      'tamale': 'Ghana',
      'cape coast': 'Ghana',
      'sekondi-takoradi': 'Ghana',
      'sunyani': 'Ghana',
      'ho': 'Ghana',
      'koforidua': 'Ghana',
      'wa': 'Ghana',
      'bolgatanga': 'Ghana',
      
      // Kenya
      'kenya': 'Kenya',
      'nairobi': 'Kenya',
      'mombasa': 'Kenya',
      'kisumu': 'Kenya',
      'nakuru': 'Kenya',
      'eldoret': 'Kenya',
      'thika': 'Kenya',
      'malindi': 'Kenya',
      'kitale': 'Kenya',
      'garissa': 'Kenya',
      
      // United States
      'usa': 'United States',
      'united states': 'United States',
      'america': 'United States',
      'new york': 'United States',
      'california': 'United States',
      'texas': 'United States',
      'florida': 'United States',
      'illinois': 'United States',
      'pennsylvania': 'United States',
      'ohio': 'United States',
      'georgia': 'United States',
      'north carolina': 'United States',
      'michigan': 'United States',
      'new jersey': 'United States',
      'virginia': 'United States',
      'washington': 'United States',
      'arizona': 'United States',
      'massachusetts': 'United States',
      'tennessee': 'United States',
      'indiana': 'United States',
      'maryland': 'United States',
      'missouri': 'United States',
      'wisconsin': 'United States',
      'colorado': 'United States',
      'minnesota': 'United States',
      'south carolina': 'United States',
      'alabama': 'United States',
      'louisiana': 'United States',
      'kentucky': 'United States',
      'oregon': 'United States',
      'oklahoma': 'United States',
      'connecticut': 'United States',
      'utah': 'United States',
      'iowa': 'United States',
      'nevada': 'United States',
      'arkansas': 'United States',
      'mississippi': 'United States',
      'kansas': 'United States',
      'new mexico': 'United States',
      'nebraska': 'United States',
      'west virginia': 'United States',
      'idaho': 'United States',
      'hawaii': 'United States',
      'new hampshire': 'United States',
      'maine': 'United States',
      'montana': 'United States',
      'rhode island': 'United States',
      'delaware': 'United States',
      'south dakota': 'United States',
      'north dakota': 'United States',
      'alaska': 'United States',
      'vermont': 'United States',
      'wyoming': 'United States',
      
      // United Kingdom
      'uk': 'United Kingdom',
      'united kingdom': 'United Kingdom',
      'england': 'United Kingdom',
      'scotland': 'United Kingdom',
      'wales': 'United Kingdom',
      'northern ireland': 'United Kingdom',
      'london': 'United Kingdom',
      'manchester': 'United Kingdom',
      'birmingham': 'United Kingdom',
      'liverpool': 'United Kingdom',
      'leeds': 'United Kingdom',
      'glasgow': 'United Kingdom',
      'edinburgh': 'United Kingdom',
      'cardiff': 'United Kingdom',
      'belfast': 'United Kingdom',
      'bristol': 'United Kingdom',
      'sheffield': 'United Kingdom',
      'leicester': 'United Kingdom',
      'coventry': 'United Kingdom',
      'bradford': 'United Kingdom',
      'nottingham': 'United Kingdom',
      
      // Canada
      'canada': 'Canada',
      'toronto': 'Canada',
      'montreal': 'Canada',
      'vancouver': 'Canada',
      'calgary': 'Canada',
      'edmonton': 'Canada',
      'ottawa': 'Canada',
      'winnipeg': 'Canada',
      'quebec city': 'Canada',
      'hamilton': 'Canada',
      'kitchener': 'Canada',
      'london': 'Canada',
      'victoria': 'Canada',
      'halifax': 'Canada',
      'oshawa': 'Canada',
      'windsor': 'Canada',
      'saskatoon': 'Canada',
      'regina': 'Canada',
      'sherbrooke': 'Canada',
      'st. johns': 'Canada',
      'barrie': 'Canada',
      'kelowna': 'Canada',
      'abbotsford': 'Canada',
      'greater sudbury': 'Canada',
      'kingston': 'Canada',
      'saguenay': 'Canada',
      'trois-rivières': 'Canada',
      'guelph': 'Canada',
      'moncton': 'Canada',
      'brantford': 'Canada',
      'saint john': 'Canada',
      'peterborough': 'Canada',
      'thunder bay': 'Canada',
      'kamloops': 'Canada',
      'red deer': 'Canada',
      'lethbridge': 'Canada',
      'nanaimo': 'Canada',
      'fredericton': 'Canada',
      'medicine hat': 'Canada',
      'vernon': 'Canada',
      'saint-jean-sur-richelieu': 'Canada',
      'brossard': 'Canada',
      'drummondville': 'Canada',
      'fort mcmurray': 'Canada',
      'prince george': 'Canada',
      'sault ste. marie': 'Canada',
      'sarnia': 'Canada',
      'wood buffalo': 'Canada',
      'new westminster': 'Canada',
      'châteauguay': 'Canada',
      'saint-jérôme': 'Canada',
      'granby': 'Canada',
      'saint-hyacinthe': 'Canada',
      'shawinigan': 'Canada',
      'dollard-des ormeaux': 'Canada',
      'brandon': 'Canada',
      'val-dor': 'Canada',
      'north bay': 'Canada',
      'belleville': 'Canada',
      'welland': 'Canada',
      'chilliwack': 'Canada',
      'kamloops': 'Canada',
      'prince albert': 'Canada',
      'vernon': 'Canada',
      'campbell river': 'Canada',
      'saint-georges': 'Canada',
      'rimouski': 'Canada',
      'saint-john': 'Canada',
      'courtenay': 'Canada',
      'saint-bruno-de-montarville': 'Canada',
      'repentigny': 'Canada',
      'blainville': 'Canada',
      'saint-charles-borromée': 'Canada',
      'saint-eustache': 'Canada',
      'boisbriand': 'Canada',
      'alma': 'Canada',
      'saint-constant': 'Canada',
      'waterloo': 'Canada',
      'saint-lambert': 'Canada',
      'beloeil': 'Canada',
      'côte-saint-luc': 'Canada',
      'pointe-claire': 'Canada',
      'salaberry-de-valleyfield': 'Canada',
      'sept-îles': 'Canada',
      'saint-laurent': 'Canada',
      'saint-jean-sur-richelieu': 'Canada',
      'saint-basile-le-grand': 'Canada',
      'saint-julie': 'Canada',
      'saint-augustin-de-desmaures': 'Canada',
      'saint-lin-laurentides': 'Canada',
      'saint-colomban': 'Canada',
      'saint-lazare': 'Canada',
      'saint-jérôme': 'Canada',
      'mirabel': 'Canada',
      'deux-montagnes': 'Canada',
      'saint-sauveur': 'Canada',
      'saint-hippolyte': 'Canada',
      'saint-calixte': 'Canada',
      'saint-donat': 'Canada',
      'sainte-marguerite-du-lac-masson': 'Canada',
      'saint-adolphe-d\'howard': 'Canada',
      'morin-heights': 'Canada',
      'saint-faustin-lac-carré': 'Canada',
      'lac-supérieur': 'Canada',
      'mont-tremblant': 'Canada',
      'lac-tremblant-nord': 'Canada',
      'labelle': 'Canada',
      'la conception': 'Canada',
      'arundel': 'Canada',
      'huberdeau': 'Canada',
      'amherst': 'Canada',
      'brébeuf': 'Canada',
      'val-des-lacs': 'Canada',
      'ontario': 'Canada',
      'quebec': 'Canada',
      'british columbia': 'Canada',
      'alberta': 'Canada',
      'manitoba': 'Canada',
      'saskatchewan': 'Canada',
      'nova scotia': 'Canada',
      'new brunswick': 'Canada',
      'newfoundland and labrador': 'Canada',
      'prince edward island': 'Canada',
      'northwest territories': 'Canada',
      'yukon': 'Canada',
      'nunavut': 'Canada'
    };
    
    console.log('Processing users for country stats. Total users:', users.length);
    
    users.forEach(user => {
      let country = 'Not specified';
      
      console.log(`Processing user: ${user.username}, location: ${user.location}`);
      
      if (user.location && user.location.trim()) {
        const location = user.location.toLowerCase().trim();
        
        // Check if location matches any key in our mapping
        for (const [locationKey, countryName] of Object.entries(locationToCountryMap)) {
          if (location.includes(locationKey)) {
            country = countryName;
            console.log(`Matched ${location} to ${country}`);
            break;
          }
        }
        
        // If no match found, try to extract from comma-separated format
        if (country === 'Not specified') {
          const locationParts = user.location.split(',');
          if (locationParts.length > 1) {
            // Check the last part (usually country)
            const lastPart = locationParts[locationParts.length - 1].trim().toLowerCase();
            for (const [locationKey, countryName] of Object.entries(locationToCountryMap)) {
              if (lastPart.includes(locationKey)) {
                country = countryName;
                console.log(`Matched comma-separated ${lastPart} to ${country}`);
                break;
              }
            }
          }
        }
        
        // If still no match, check for coordinate format and skip it
        if (country === 'Not specified') {
          if (location.includes('lat:') && location.includes('lng:') || 
              /lat:\s*-?\d+\.?\d*,?\s*lng:\s*-?\d+\.?\d*/i.test(location)) {
            country = 'Location coordinates';
            console.log(`Skipping coordinate location: ${location}`);
          } else {
            // Use the original location as country (capitalized) only if it's not coordinates
            country = user.location.trim().charAt(0).toUpperCase() + user.location.trim().slice(1).toLowerCase();
            console.log(`Using original location as country: ${country}`);
          }
        }
      }
      
      countryCounts[country] = (countryCounts[country] || 0) + 1;
    });
    
    console.log('Final country counts:', countryCounts);

    const countryStats = {};
    Object.entries(countryCounts).forEach(([country, count]) => {
      countryStats[country] = {
        count: count,
        percentage: parseFloat(((count / totalUsers) * 100).toFixed(1))
      };
    });

    // Age Range Statistics
    const ageRangeCounts = { '18-25': 0, '26-35': 0, '36-45': 0, '46+': 0, 'Not specified': 0 };
    users.forEach(user => {
      if (user.dob || user.birthday) {
        const birthDate = new Date(user.dob || user.birthday);
        const age = new Date().getFullYear() - birthDate.getFullYear();
        
        if (age >= 18 && age <= 25) ageRangeCounts['18-25']++;
        else if (age >= 26 && age <= 35) ageRangeCounts['26-35']++;
        else if (age >= 36 && age <= 45) ageRangeCounts['36-45']++;
        else if (age >= 46) ageRangeCounts['46+']++;
        else ageRangeCounts['Not specified']++;
      } else {
        ageRangeCounts['Not specified']++;
      }
    });

    const ageRangeStats = {};
    Object.entries(ageRangeCounts).forEach(([range, count]) => {
      ageRangeStats[range] = {
        count: count,
        percentage: parseFloat(((count / totalUsers) * 100).toFixed(1))
      };
    });

    // Gender Statistics
    const genderCounts = {};
    users.forEach(user => {
      const gender = user.gender || 'Not specified';
      genderCounts[gender] = (genderCounts[gender] || 0) + 1;
    });

    const genderStats = {};
    Object.entries(genderCounts).forEach(([gender, count]) => {
      genderStats[gender] = {
        count: count,
        percentage: parseFloat(((count / totalUsers) * 100).toFixed(1))
      };
    });

    // Role Statistics
    const roleCounts = {};
    users.forEach(user => {
      const role = user.role || 'user';
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    });

    const roleStats = {};
    Object.entries(roleCounts).forEach(([role, count]) => {
      roleStats[role] = {
        count: count,
        percentage: parseFloat(((count / totalUsers) * 100).toFixed(1))
      };
    });

    // Registration Trends (Last 12 months)
    const monthCounts = {};
    const currentDate = new Date();
    
    for (let i = 11; i >= 0; i--) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const monthKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      monthCounts[monthKey] = 0;
    }

    users.forEach(user => {
      if (user.createdAt) {
        const userDate = new Date(user.createdAt);
        const monthKey = userDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (monthCounts.hasOwnProperty(monthKey)) {
          monthCounts[monthKey]++;
        }
      }
    });

    const registrationTrends = {};
    Object.entries(monthCounts).forEach(([month, count]) => {
      registrationTrends[month] = {
        count: count,
        percentage: parseFloat(((count / totalUsers) * 100).toFixed(1))
      };
    });

    console.log('📈 Sending analytics response:', {
      totalUsers,
      countryStatsCount: Object.keys(countryStats).length,
      ageRangeStatsCount: Object.keys(ageRangeStats).length,
      genderStatsCount: Object.keys(genderStats).length,
      roleStatsCount: Object.keys(roleStats).length,
      registrationTrendsCount: Object.keys(registrationTrends).length
    });

    res.json({
      totalUsers,
      countryStats,
      ageRangeStats,
      genderStats,
      roleStats,
      registrationTrends,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: 'Failed to generate analytics' });
  }
});

// 📝 Download Analytics as PDF (SuperAdmin only)
router.get('/analytics.pdf', verifyTokenAndRole(['superadmin']), async (req, res) => {
  try {
    if (!PDFDocument) {
      return res.status(500).json({ message: 'PDF export unavailable. Install pdfkit.' });
    }

    const users = await User.find({});
    const totalUsers = users.length;

    // Build stats (aligned with /analytics)
    const countryStats = {};
    const roleStats = {};
    const genderStats = {};
    const ageRangeStats = { '18-25': 0, '26-35': 0, '36-45': 0, '46+': 0, 'Not specified': 0 };
    const registrationTrends = {};

    // Country counts (fallback to raw location/country fields)
    users.forEach(user => {
      const country = (user.location || user.country || 'Not specified').trim();
      countryStats[country] = (countryStats[country] || 0) + 1;
    });

    // Role counts
    users.forEach(user => {
      const role = user.role || 'user';
      roleStats[role] = (roleStats[role] || 0) + 1;
    });

    // Gender counts
    users.forEach(user => {
      const gender = user.gender || 'Not specified';
      genderStats[gender] = (genderStats[gender] || 0) + 1;
    });

    // Age buckets
    users.forEach(user => {
      if (user.dob || user.birthday) {
        const birthDate = new Date(user.dob || user.birthday);
        const age = new Date().getFullYear() - birthDate.getFullYear();
        if (age >= 18 && age <= 25) ageRangeStats['18-25']++;
        else if (age >= 26 && age <= 35) ageRangeStats['26-35']++;
        else if (age >= 36 && age <= 45) ageRangeStats['36-45']++;
        else if (age >= 46) ageRangeStats['46+']++;
        else ageRangeStats['Not specified']++;
      } else {
        ageRangeStats['Not specified']++;
      }
    });

    // Registration trends (last 12 months)
    const monthCounts = {};
    const currentDate = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const monthKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      monthCounts[monthKey] = 0;
    }
    users.forEach(user => {
      if (user.createdAt) {
        const userDate = new Date(user.createdAt);
        const monthKey = userDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (monthCounts.hasOwnProperty(monthKey)) {
          monthCounts[monthKey]++;
        }
      }
    });
    Object.keys(monthCounts).forEach(k => { registrationTrends[k] = monthCounts[k]; });

    // Create PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="ConnectHer_Analytics_Report.pdf"');
    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text('ConnectHer Analytics Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(16).text('Summary');
    doc.moveDown(0.2);
    doc.fontSize(12).text(`Total Users: ${totalUsers}`);
    doc.moveDown();

    const writeSection = (title, obj) => {
      doc.fontSize(14).text(title);
      doc.moveDown(0.2);
      doc.fontSize(11);
      Object.keys(obj).sort().forEach(k => {
        doc.text(`${k}: ${obj[k]}`);
      });
      doc.moveDown();
    };

    writeSection('By Country', countryStats);
    writeSection('By Role', roleStats);
    writeSection('By Gender', genderStats);
    writeSection('By Age Range', ageRangeStats);
    writeSection('Registrations by Month', registrationTrends);

    doc.end();
  } catch (err) {
    console.error('❌ PDF analytics error:', err);
    res.status(500).json({ message: 'Failed to generate analytics PDF' });
  }
});


module.exports = router;
