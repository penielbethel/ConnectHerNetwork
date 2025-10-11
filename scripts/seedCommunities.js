require('dotenv').config();
const mongoose = require('mongoose');
const Community = require('../models/Community');
const User = require('../models/User');

const MONGO = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/connecther';

async function main() {
  console.log('🔌 Connecting to MongoDB:', MONGO);
  await mongoose.connect(MONGO, { autoIndex: false });
  console.log('✅ Connected');

  const users = await User.find({}).select('username avatar firstName surname').lean();
  const userSet = new Set(users.map(u => u.username));

  const communities = await Community.find({});
  console.log(`📚 Found ${communities.length} communities`);

  let fixed = 0;
  for (const c of communities) {
    let changed = false;
    // Ensure creator is a member and admin
    if (c.creator) {
      if (!c.members.includes(c.creator)) {
        c.members.push(c.creator);
        changed = true;
      }
      if (!c.admins.includes(c.creator)) {
        c.admins.push(c.creator);
        changed = true;
      }
    }

    // Drop any orphaned usernames from members/admins not present in users collection
    const validMembers = c.members.filter(m => userSet.has(m));
    if (validMembers.length !== c.members.length) {
      c.members = validMembers;
      changed = true;
    }
    const validAdmins = c.admins.filter(a => userSet.has(a));
    if (validAdmins.length !== c.admins.length) {
      c.admins = validAdmins;
      changed = true;
    }

    // Default avatar placeholder if missing
    if (!c.avatar) {
      c.avatar = 'https://via.placeholder.com/50';
      changed = true;
    }

    if (changed) {
      await c.save();
      fixed++;
    }
  }

  console.log(`🛠️ Updated ${fixed} communities with membership/admin defaults and cleanup.`);

  // Print per-user summary
  for (const u of users) {
    const owned = communities.filter(c => c.creator === u.username).length;
    const joined = communities.filter(c => c.members.includes(u.username) && c.creator !== u.username).length;
    if (owned || joined) {
      console.log(`👤 ${u.username}: owned=${owned}, joined=${joined}`);
    }
  }

  await mongoose.disconnect();
  console.log('✅ Done.');
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});