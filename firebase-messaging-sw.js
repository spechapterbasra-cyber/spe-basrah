// Firebase Cloud Messaging service worker for SPE Basrah Web/PWA.
// Keep this file in the web/ directory so it is copied to build/web.
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBDvVrOx4Y3gU4ru4zSGnPlNfN5boYrfZ0',
  authDomain: 'spe-basra-app.firebaseapp.com',
  projectId: 'spe-basra-app',
  storageBucket: 'spe-basra-app.firebasestorage.app',
  messagingSenderId: '241303672631',
  appId: '1:241303672631:web:1acb2e0aba8c64836decb2',
  measurementId: 'G-NC8MMPBZTL',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((message) => {
  console.log('[SPE Basrah] background FCM message', message.messageId || message);
});


self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl =
    event.notification?.data?.link ||
    'https://spechapterbasra-cyber.github.io/spe-basrah/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
