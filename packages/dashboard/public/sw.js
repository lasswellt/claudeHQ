// CAP-032 / story 013-010: minimal service worker for foreground
// browser notifications with approve/deny action buttons.
//
// Full VAPID Web Push (background pushes when the tab is closed)
// is a follow-up story — it requires hub-side keypair generation,
// the `web-push` library, and persistent subscription storage.
// This worker only needs to exist so the dashboard can use
// `ServiceWorkerRegistration.showNotification(title, { actions })`
// which is the only API that supports action buttons.

self.addEventListener('install', (event) => {
  // Activate immediately on first install — no waiting for old
  // pages to unload.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any pages that were already loaded before the
  // worker registered, so the first-use notification flow works
  // without a page reload.
  event.waitUntil(self.clients.claim());
});

/**
 * `notificationclick` fires when the user taps the notification or
 * clicks one of its action buttons. We:
 *   1. Close the notification so it disappears from the tray.
 *   2. Focus an existing dashboard tab if one is open; otherwise
 *      open a new one.
 *   3. PostMessage the action (`approve` / `deny` / `default`) and
 *      the approval id to the focused client so the in-page code
 *      can resolve the approval via the existing store.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const approvalId = event.notification.data && event.notification.data.approvalId;
  const action = event.action || 'default'; // 'approve' | 'deny' | ''

  const payload = { type: 'approval-notification-click', approvalId, action };
  const targetUrl = approvalId ? `/approvals?focus=${approvalId}` : '/approvals';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        // If a dashboard tab is open, focus it and post the action.
        if (client.url.includes(self.registration.scope)) {
          try {
            await client.focus();
          } catch {
            // ignore — some browsers throw on focus when minimized
          }
          client.postMessage(payload);
          return;
        }
      }

      // No open dashboard tab — open a new one and let the app
      // pick up the action query param on load.
      if (self.clients.openWindow) {
        const url = new URL(targetUrl, self.registration.scope);
        if (action !== 'default') url.searchParams.set('action', action);
        await self.clients.openWindow(url.toString());
      }
    })(),
  );
});
