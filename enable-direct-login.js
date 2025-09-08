// Script to enable direct login for specific users
const axios = require('axios');

// Configuration
const SERVER_URL = 'http://connecther.network'; // Production server URL
const USERNAMES = ['lolkhan', 'Oluwasegun112', 'Dennis'];

async function enableDirectLogin() {
  try {
    console.log('🚀 Enabling direct login for users:', USERNAMES);
    
    const response = await axios.post(`${SERVER_URL}/api/auth/admin/toggle-direct-login`, {
      usernames: USERNAMES,
      enable: true
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Success:', response.data);
    console.log(`📊 Modified ${response.data.modifiedCount} users`);
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

// Run the script
enableDirectLogin();