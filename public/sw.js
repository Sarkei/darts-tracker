/**
 * Service Worker für Push-Benachrichtigungen.
 *
 * Liegt als `/sw.js` im App-Ordner und wird vom Browser installiert, sobald die
 * App geladen wird. Er läuft auch weiter, wenn die App geschlossen ist — nur so
 * kommen Nachrichten an, während niemand die Seite offen hat.
 *
 * Wichtig: Der Service Worker cached **nichts**. Die Apps liefern ihre Dateien
 * über gehashte Namen aus; ein Cache würde nach einem Deploy alte Stände zeigen.
 */

self.addEventListener('install', (event) => {
  // Sofort aktiv werden, nicht auf den nächsten Start warten.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Push-Nachricht empfangen und anzeigen.
 *
 * Der Server schickt JSON mit `title`, `body` und optional `url`.
 */
self.addEventListener('push', (event) => {
  let daten = { title: 'Benachrichtigung', body: '', url: '/' };
  try {
    if (event.data) daten = { ...daten, ...event.data.json() };
  } catch {
    // Kein JSON — dann den reinen Text nehmen.
    if (event.data) daten.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(daten.title, {
      body: daten.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Ein Tag pro Nachrichtentyp: gleiche Nachrichten ersetzen sich,
      // statt sich zu stapeln.
      tag: daten.tag || 'allgemein',
      data: { url: daten.url || '/' },
      vibrate: [90, 40, 90],
    }),
  );
});

/** Klick auf die Benachrichtigung: App öffnen oder in den Vordergrund holen. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      // Schon offen? Dann dorthin springen.
      for (const f of fenster) {
        if ('focus' in f) {
          f.navigate(ziel);
          return f.focus();
        }
      }
      // Sonst neu öffnen.
      if (self.clients.openWindow) return self.clients.openWindow(ziel);
      return undefined;
    }),
  );
});
