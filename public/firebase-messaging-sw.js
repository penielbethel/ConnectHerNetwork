// Import Firebase scripts
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Initialize Firebase
firebase.initializeApp({
  apiKey: "AIzaSyCsQwg0D4gH1xCUiBmVi-nKoSEGHNy40yY",
  authDomain: "connecther-76f65.firebaseapp.com",
  projectId: "connecther-76f65",
  storageBucket: "connecther-76f65.firebasestorage.app",
  messagingSenderId: "745841685228",
  appId: "1:745841685228:web:d9b0dda1a964c9a564ebc9",
  measurementId: "G-4G8THWFDY5"
});

const messaging = firebase.messaging();

// ✅ Background push notifications handler
messaging.onBackgroundMessage(function (payload) {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);

  const { title, body } = payload.notification || {};
  const notificationOptions = {
    body: body || "You have a new alert",
    icon: '/logo.png',
    vibrate: [200, 100, 200],
    tag: 'push-alert',
    renotify: true
    // Note: No sound key here — browser doesn't auto-play
  };

  self.registration.showNotification(title || "Notification", notificationOptions);
});

// ✅ Handle click event for background notifications
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
