/* ELSEWHERE service worker
   Shell only. Cross-origin and range requests are never touched. */

var VERSION = 'elsewhere-v1';
var CORE = [
  '/',
  '/index.html',
  '/assets/css/app.css',
  '/assets/js/geo.js',
  '/assets/js/rng.js',
  '/assets/js/generator.js',
  '/assets/js/journal.js',
  '/assets/js/nav.js',
  '/assets/js/app.js',
  '/assets/vendor/leaflet/leaflet.js',
  '/assets/vendor/leaflet/leaflet.css',
  '/manifest.webmanifest',
  '/assets/img/favicon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // one failure must not reject the whole install
      return Promise.allSettled(CORE.map(function (url) {
        return fetch(url, { cache: 'reload' }).then(function (res) {
          if (!res || !res.ok) throw new Error('skip ' + url);
          return cache.put(url, res);
        }).catch(function () { /* keep going */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // never touch anything off-origin: map tiles, place names, analytics
  if (url.origin !== self.location.origin) return;

  // never touch range requests
  if (req.headers.has('range')) return;

  // navigations: network first so a deploy is picked up, cache as fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put('/index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('/index.html').then(function (hit) {
          return hit || caches.match('/');
        });
      })
    );
    return;
  }

  // static assets: cache first, refresh in the background
  event.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
