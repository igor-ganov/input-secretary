export const pageHtml = (vapidPublicKey: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>S3 Web Push spike</title>
</head>
<body>
<main>
  <h1>S3 Web Push spike</h1>
  <button id="subscribe" type="button">Subscribe</button>
  <p>Permission: <output id="permission"></output></p>
  <p>Subscription: <output id="subscription">none</output></p>
  <p>Last push: <output id="received" aria-live="polite">none</output></p>
</main>
<script type="module">
const vapidKey = ${JSON.stringify(vapidPublicKey)};
const fromB64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const $ = (id) => document.getElementById(id);
$("permission").textContent = Notification.permission;
navigator.serviceWorker.addEventListener("message", (event) => {
  console.log("[push] received", event.data);
  $("received").textContent = event.data;
  document.body.dataset.pushReceived = event.data;
});
const subscribe = async () => {
  const permission = await Notification.requestPermission();
  $("permission").textContent = permission;
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64Url(vapidKey) });
  const res = await fetch("/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription) });
  $("subscription").textContent = res.ok ? new URL(subscription.endpoint).host : "store failed " + res.status;
  console.log("[push] subscribed", subscription.endpoint);
};
$("subscribe").addEventListener("click", () => subscribe().catch((error) => {
  console.log("[push] subscribe failed", String(error));
  $("subscription").textContent = "error: " + String(error);
}));
</script>
</body>
</html>`;

export const serviceWorkerJs = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  const text = event.data ? event.data.text() : "(no payload)";
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage(text));
    await self.registration.showNotification("Input Secretary spike", { body: text });
  })());
});
`;
