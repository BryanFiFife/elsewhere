/* ============================================================
   places.js — known places, fetched in the browser and kept
   in IndexedDB.

   Source: Wikipedia GeoSearch, which returns every geotagged
   article in a radius. That is a good definition of a place
   somebody thought worth writing down, it needs no key, and it
   sends Access-Control-Allow-Origin: * so the page can read it
   directly.

   Everything is stored locally. Nothing about the user is sent
   anywhere; the only outbound data is the coordinate being
   searched for.
   ============================================================ */
(function (global) {
  'use strict';

  var DB_NAME = 'elsewhere-places';
  var DB_VER = 1;
  var STORE = 'places';
  var META = 'queries';
  var TTL = 24 * 60 * 60 * 1000;
  var MAX_ROWS = 8000;
  var MAX_RADIUS = 10000;   // the API's limit

  var dbPromise = null;
  var memAll = null;        // in-memory mirror of the store
  var idbBroken = false;

  /* ---- IndexedDB plumbing ---------------------------------------- */
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { idbBroken = true; return reject(new Error('no IndexedDB')); }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { idbBroken = true; return reject(e); }

      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { idbBroken = true; reject(req.error || new Error('idb open failed')); };
      req.onblocked = function () { reject(new Error('idb blocked')); };
    });
    return dbPromise;
  }

  function reqP(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function getAll() {
    return open().then(function (db) {
      return reqP(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    }).then(function (rows) { return rows || []; });
  }

  function putMany(items) {
    if (!items.length) return Promise.resolve(0);
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, 'readwrite');
        var s = t.objectStore(STORE);
        for (var i = 0; i < items.length; i++) s.put(items[i]);
        t.oncomplete = function () { resolve(items.length); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('idb abort')); };
      });
    });
  }

  function getMeta(k) {
    return open().then(function (db) {
      return reqP(db.transaction(META, 'readonly').objectStore(META).get(k));
    }).then(function (row) { return row || null; });
  }

  function setMeta(k, v) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(META, 'readwrite');
        t.objectStore(META).put({ k: k, ts: v.ts, n: v.n });
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function countRows() {
    return open().then(function (db) {
      return reqP(db.transaction(STORE, 'readonly').objectStore(STORE).count());
    });
  }

  /* keep the store bounded: drop the oldest quarter when it grows */
  function trim() {
    return countRows().then(function (n) {
      if (n <= MAX_ROWS) return 0;
      return getAll().then(function (rows) {
        rows.sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
        var drop = rows.slice(0, Math.ceil(rows.length * 0.25));
        return open().then(function (db) {
          return new Promise(function (resolve, reject) {
            var t = db.transaction(STORE, 'readwrite');
            var s = t.objectStore(STORE);
            drop.forEach(function (r) { s.delete(r.id); });
            t.oncomplete = function () { resolve(drop.length); };
            t.onerror = function () { reject(t.error); };
          });
        });
      });
    });
  }

  /* ---- the source ------------------------------------------------ */
  function fetchWikipedia(lat, lon, radius) {
    var r = Math.max(500, Math.min(MAX_RADIUS, Math.round(radius)));
    var url = 'https://en.wikipedia.org/w/api.php' +
      '?action=query&list=geosearch' +
      '&gscoord=' + encodeURIComponent(lat.toFixed(5) + '|' + lon.toFixed(5)) +
      '&gsradius=' + r +
      '&gslimit=500&gsnamespace=0&format=json&origin=*';

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 14000) : null;

    return fetch(url, {
      signal: ctrl ? ctrl.signal : undefined,
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('places ' + res.status);
      return res.json();
    }).then(function (json) {
      var rows = (json && json.query && json.query.geosearch) || [];
      var now = Date.now();
      return rows.map(function (x) {
        return {
          id: 'wp:' + x.pageid,
          src: 'wikipedia',
          name: x.title,
          lat: x.lat,
          lon: x.lon,
          t: now,
          url: 'https://en.wikipedia.org/?curid=' + x.pageid
        };
      });
    });
  }

  /* ---- filtering -------------------------------------------------- */
  function within(list, origin, radius) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
      var d = global.EW.geo.distance(origin, p);
      if (d <= radius) { p.d = d; out.push(p); }
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out;
  }

  function cacheKey(origin, radius) {
    return origin.lat.toFixed(3) + '|' + origin.lon.toFixed(3) + '|' + radius;
  }

  /* ---- public ------------------------------------------------------ */
  function ensure(origin, radius, opts) {
    opts = opts || {};
    if (!origin || !isFinite(origin.lat) || !isFinite(origin.lon)) {
      return Promise.resolve({ places: [], count: 0, cached: false, fetchedAt: 0, error: 'no origin' });
    }

    var key = cacheKey(origin, radius);

    var base = loadAll().then(function (all) {
      return getMeta(key).then(function (meta) {
        var fresh = !!(meta && (Date.now() - meta.ts) < (opts.ttl || TTL));
        if (fresh && !opts.force) {
          return { places: within(all, origin, radius), all: all, count: 0, cached: true, fetchedAt: meta.ts, error: null };
        }
        return fetchWikipedia(origin.lat, origin.lon, radius).then(function (items) {
          return putMany(items)
            .then(function () { return setMeta(key, { ts: Date.now(), n: items.length }); })
            .then(trim)
            .then(function () { memAll = null; return loadAll(); })
            .then(function (all2) {
              var local = within(all2, origin, radius);
              return {
                places: local, all: all2, count: local.length,
                cached: false, fetchedAt: Date.now(), added: items.length, error: null
              };
            });
        });
      });
    });

    return base.then(function (res) {
      res.count = res.places.length;
      return res;
    }).catch(function (err) {
      return loadAll().then(function (all) {
        var local = within(all, origin, radius);
        return {
          places: local, all: all, count: local.length,
          cached: true, fetchedAt: 0, error: String((err && err.message) || err)
        };
      }).catch(function () {
        return { places: [], all: [], count: 0, cached: false, fetchedAt: 0, error: 'storage unavailable' };
      });
    });
  }

  function loadAll() {
    if (memAll) return Promise.resolve(memAll);
    if (idbBroken) return Promise.resolve([]);
    return getAll().then(function (rows) {
      memAll = rows;
      return rows;
    }).catch(function () { idbBroken = true; memAll = []; return []; });
  }

  function forget() {
    memAll = null;
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([STORE, META], 'readwrite');
        t.objectStore(STORE).clear();
        t.objectStore(META).clear();
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error); };
      });
    }).catch(function () { return false; });
  }

  function inventory() {
    return loadAll().then(function (all) {
      return { stored: all.length, oldest: all.length ? Math.min.apply(null, all.map(function (p) { return p.t || 0; })) : 0 };
    });
  }

  global.EW = global.EW || {};
  global.EW.places = {
    ensure: ensure,
    inventory: inventory,
    forget: forget,
    within: within,
    TTL: TTL,
    MAX_RADIUS: MAX_RADIUS
  };
})(window);
