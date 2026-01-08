const CACHE_NAME = 'visitsafe-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Import Firebase Scripts (Compat versions)
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Initialize Firebase using URL params[]
const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

// Initialize Firebase Messaging if config is present
if (firebaseConfig.apiKey) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // Background Message Handler with Action Buttons
  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);

    const { title, body, icon } = payload.notification || {};
    const data = payload.data || {};

    // Check if this is a visitor request notification
    // Match actionType sent from backend
    const isVisitorRequest = data.actionType === 'VISITOR_REQUEST' || data.type === 'visitor_request';

    const notificationOptions = {
      body: body,
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.visitorId || payload.messageId,
      requireInteraction: isVisitorRequest,
      data: data
    };

    // Add action buttons for visitor requests
    if (isVisitorRequest) {
      notificationOptions.actions = [
        {
          action: 'APPROVE_VISITOR',
          title: '✅ Approve',
          icon: '/icons/check.png'
        },
        {
          action: 'REJECT_VISITOR',
          title: '❌ Reject',
          icon: '/icons/x.png'
        }
      ];
    }

    self.registration.showNotification(title, notificationOptions);
  });
}

// Handle notification clicks and actions
// Handle notification clicks and actions
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click received:', event);

  const action = event.action;
  const data = event.notification.data || {};

  event.notification.close();

  if (action === 'APPROVE_VISITOR' || action === 'REJECT_VISITOR') {
    // Perform API call in background WITHOUT opening app
    let url = action === 'APPROVE_VISITOR' ? data.actionUrlApprove : data.actionUrlReject;

    // Fallback URL construction if not provided in payload
    if (!url && data.requestId && data.residencyId) {
      const baseUrl = self.location.origin;
      const actionParam = action === 'APPROVE_VISITOR' ? 'approve' : 'reject';
      url = `${baseUrl}/api/visitor-action?action=${actionParam}&residencyId=${data.residencyId}&requestId=${data.requestId}`;
      console.log('[SW] Constructed fallback action URL:', url);
    }

    if (url) {
      const promiseChain = fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(response => {
          if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
          return response.json();
        })
        .then(responseData => {
          console.log('Background action success:', responseData);
          // Send message to app for UI sync (if app is open)
          return clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
              windowClients.forEach(client => {
                client.postMessage({
                  type: 'NOTIFICATION_ACTION_SUCCESS',
                  action: action,
                  requestId: data.requestId || data.visitorId,
                  status: action === 'APPROVE_VISITOR' ? 'approved' : 'rejected'
                });
              });
              // DO NOT open or focus app - action completed in background
            });
        })
        .catch(err => {
          console.error('Background action failed:', err);
          // Send failure message to app (if open)
          clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
              windowClients.forEach(client => {
                client.postMessage({
                  type: 'NOTIFICATION_ACTION_FAILED',
                  action: action,
                  requestId: data.requestId || data.visitorId,
                  error: err.message
                });
              });
            });
        });

      event.waitUntil(promiseChain);
    } else {
      console.error('No action URL provided and insufficient data to construct fallback');
    }
  } else {
    // Default click - open app only for non-action clicks
    // Prioritize deep linking if requestId is present
    let urlToOpen = data.click_action || '/';
    if (data.requestId && urlToOpen === '/') {
      urlToOpen = `/resident-dashboard?requestId=${data.requestId}`;
    }

    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            // Focus if already open
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              // Optionally navigate to specific request if needed, but focus is primary
              if (urlToOpen !== '/' && client.navigate) {
                return client.navigate(urlToOpen).then(c => c.focus());
              }
              return client.focus();
            }
          }
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
    );
  }
});

// === PWA LOGIC ===

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ❌ Do NOT cache Firestore requests
  if (url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com')) {
    return;
  }

  // ❌ Do NOT cache API calls
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network First Strategy
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Check if valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Only cache same-origin requests (static assets)
        if (url.origin === location.origin) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }

        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          // Offline fallback for navigation
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
