importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

self.addEventListener("notificationclick", function(event) {
  const action = event.action;
  const data = event.notification?.data || {};
  const requestId = data.requestId;
  let status = null;
  if (action === "approve") status = "approved";
  if (action === "reject") status = "rejected";
  if (status && requestId) {
    event.waitUntil(
      fetch("/api/update-request-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status })
      })
    );
  }
  event.notification.close();
});
