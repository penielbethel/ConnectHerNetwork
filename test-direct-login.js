// Script to test direct login functionality
const axios = require('axios');

// Configuration
const SERVER_URL = 'http://connecther.network';
const TEST_USERNAMES = ['lolkhan', 'Oluwasegun112', 'Dennis'];

async function testDirectLogin() {
  console.log('🧪 Testing direct login functionality...');
  
  for (const username of TEST_USERNAMES) {
    try {
      console.log(`\n🔐 Testing direct login for: ${username}`);
      
      const response = await axios.post(`${SERVER_URL}/api/auth/direct-login`, {
        username: username
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.token) {
        console.log(`✅ Success! Token received for ${username}`);
        console.log(`📋 User ID: ${response.data.user._id}`);
        console.log(`👤 Full Name: ${response.data.user.firstName} ${response.data.user.surname}`);
      } else {
        console.log(`❌ Failed: No token received for ${username}`);
      }
      
    } catch (error) {
      console.error(`❌ Error testing ${username}:`, error.response?.data?.message || error.message);
    }
  }
  
  console.log('\n🎯 Direct login testing completed!');
}

// Run the test
testDirectLogin();