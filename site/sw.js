/* Service worker: página offline + última lista conhecida de fotos. */
importScripts('config.js');

var CFG = self.SLIDESHOW_CONFIG || {};
var SHELL_CACHE = 'shell-' + (CFG.cacheVersion || 'v1');
var DATA_CACHE = 'data-v1';
var SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'media/nosleep.mp4'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      if (k !== SHELL_CACHE && k !== DATA_CACHE) return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = req.url;

  // Lista de fotos (Worker): rede primeiro, cache como reserva
  // (só a lista; as fotos em /photo seguem o caminho normal do navegador)
  if (CFG.workerUrl && url.split('?')[0].replace(/\/$/, '') === CFG.workerUrl.replace(/\/$/, '')) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(DATA_CACHE).then(function (c) { c.put(CFG.workerUrl, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(CFG.workerUrl);
    }));
    return;
  }

  // Arquivos da própria página: cache primeiro, atualiza em segundo plano
  if (url.indexOf(self.location.origin) === 0 && req.headers.get('range') === null) {
    e.respondWith(caches.open(SHELL_CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res.ok && res.status === 200) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
  // Fotos do iCloud e demais: comportamento normal do navegador
});
