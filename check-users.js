// Script to check if users exist and create them if needed
const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function checkAndCreateUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const usernames = ['lolkhan', 'Oluwasegun112', 'Dennis'];
    
    console.log('🔍 Checking existing users...');
    
    for (const username of usernames) {
      const existingUser = await User.findOne({ username });
      
      if (existingUser) {
        console.log(`✅ User '${username}' exists`);
        
        // Enable direct login for existing user
        if (!existingUser.directLoginEnabled) {
          await User.updateOne(
            { username },
            { directLoginEnabled: true }
          );
          console.log(`🔓 Direct login enabled for '${username}'`);
        } else {
          console.log(`🔓 Direct login already enabled for user '${username}'`);
        }
        
      } else {
        console.log(`❌ User '${username}' does not exist`);
        
        // Create basic user with direct login enabled
        const newUser = new User({
          firstName: username,
          surname: 'User',
          username: username,
          email: `${username}@connecther.network`,
          password: 'temp123', // Temporary password (won't be used for direct login)
          birthday: '1990-01-01',
          location: 'Unknown',
          avatar: 'https://via.placeholder.com/150', // Default avatar
          gender: 'Female',
          directLoginEnabled: true
        });
        
        await newUser.save();
        console.log(`✅ Created user '${username}' with direct login enabled`);
      }
    }
    
    console.log('\n🎉 All users processed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
checkAndCreateUsers();