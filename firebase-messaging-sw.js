// Firebase Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Firebase config
firebase.initializeApp({
  apiKey: "AIzaSyDN0gEe9Z9TgOsn7FyiDKlL4G9Z2Y4bGQk",
  authDomain: "depo-paketleme.firebaseapp.com",
  projectId: "depo-paketleme",
  storageBucket: "depo-paketleme.firebasestorage.app",
  messagingSenderId: "1030488145610",
  appId: "1:1030488145610:web:5e9f8e8e8e8e8e8e8e8e8e"
});

const messaging = firebase.messaging();

// Background notification handler
messaging.onBackgroundMessage((payload) => {
  console.log('Background mesaj alındı:', payload);
  
  const notificationTitle = payload.notification.title || 'Yeni Bildirim';
  const notificationOptions = {
    body: payload.notification.body || '',
    icon: '/icon.png',
    badge: '/badge.png',
    vibrate: [200, 100, 200],
    requireInteraction: true
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
