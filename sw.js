// Mode hors ligne : l'app (page, styles, scripts) reste disponible sans réseau, et les playlists sont déjà sur l'appareil.
// En ligne on prend toujours la version fraîche ; hors ligne on retombe sur la copie gardée.
// Seuls les fichiers de ce site sont gardés (plus les polices) : SoundCloud, Firebase et GetSongBPM ne passent jamais par ici.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `simple-playlist-${VERSION}`;
const FONTS = 'simple-playlist-fonts';
const MODULES = ['app', 'core', 'library', 'bookmarklet', 'sample', 'zip', 'serato', 'keys', 'cloud', 'firebase', 'share', 'tunefile'];
const SHELL = ['./', `style.css?v=${VERSION}`, 'manifest.webmanifest', 'icons/icon-192.png', ...MODULES.map((m) => `js/${m}.js?v=${VERSION}`)];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const fresh = async (request, cacheName, fallbackKey) => {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(request)) || (fallbackKey && (await cache.match(fallbackKey, { ignoreSearch: true })));
    if (hit) return hit;
    throw e;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(fresh(request, CACHE, request.mode === 'navigate' ? './' : null));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(request);
        const net = fetch(request).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()); return res; });
        return hit || net;
      }),
    );
  }
});
