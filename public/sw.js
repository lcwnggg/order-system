// Service worker mínimo: solo recibe avisos push y abre la app al pulsarlos.
// No cachea nada a propósito — el objetivo aquí es la notificación, y una
// caché mal hecha serviría páginas viejas del panel sin avisar.

self.addEventListener("install", () => {
  // Activarse sin esperar a que se cierren las pestañas viejas
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Nuevo pedido";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [100, 50, 100],
    // tag por pedido: si llegan dos avisos del mismo pedido no se apilan
    tag: payload.tag || "pedido",
    renotify: true,
    data: { url: payload.url || "/admin/orders" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin/orders";

  // Si ya hay una pestaña de la app abierta, se reutiliza en vez de abrir otra
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
