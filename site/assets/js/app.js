/* ============================================================
   app.js — the whole UI
   ============================================================ */
(function () {
  'use strict';

  var EW = window.EW;
  var G = EW.geo;

  var RADII = [250, 500, 1000, 3000, 8000, 20000];
  var RADIUS_LABEL = ['250 m', '500 m', '1 km', '3 km', '8 km', '20 km'];
  var ZOOM = [16, 15.5, 15, 13.5, 12.5, 11.5];
  var LABEL = { attractor: 'Attractor', void: 'Void', random: 'Random', blind: 'Blind spot' };
  var COLOR = { attractor: '#d8ff3e', void: '#8f74ff', random: '#c9c7c0', blind: '#ffb03a' };
  var PREFS = 'elsewhere.prefs.v1';

  var el = {};
  var map = null;
  var markers = {};
  var placeCache = {};
  var placeQueue = null;
  var lastPlaceQuery = 0;

  var state = {
    origin: null,
    myPos: null,
    heading: null,
    radiusIdx: 2,
    type: 'attractor',
    intention: '',
    current: null,
    navMode: false,
    arrivedOnce: false,
    mapStyle: 'dark',
    shared: false,
    geoDenied: false
  };

  /* ---- tiny helpers ---------------------------------------------- */
  function qs(s, root) { return (root || document).querySelector(s); }
  function qsa(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-up');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('is-up'); }, ms || 2400);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtP(p) {
    if (!isFinite(p)) return '--';
    if (p <= 0) return '< 1e-16';
    if (p < 0.001) return p.toExponential(1);
    return p.toFixed(3);
  }

  function nf(n) { return Number(n).toLocaleString('en-GB'); }

  /* ---- boot ------------------------------------------------------- */
  function boot() {
    el = {
      map: qs('#map'),
      sheet: qs('#sheet'),
      panels: qsa('.panel'),
      intention: qs('#intention'),
      typeSeg: qs('#typeSeg'),
      radius: qs('#radius'),
      radiusOut: qs('#radiusOut'),
      btnGenerate: qs('#btnGenerate'),
      status: qs('#status'),
      notice: qs('#notice'),
      noticeText: qs('#noticeText'),
      noticeClose: qs('#noticeClose'),
      navhud: qs('#navhud'),
      needle: qs('#needle'),
      navDist: qs('#navDist'),
      navUnit: qs('#navUnit'),
      navBearing: qs('#navBearing'),
      navCompass: qs('#navCompass'),
      drawer: qs('#drawer'),
      about: qs('#about'),
      journalList: qs('#journalList'),
      journalBadge: qs('#journalBadge'),
      drawerSub: qs('#drawerSub'),
      toast: qs('#toast'),
      resType: qs('#resType'),
      resZ: qs('#resZ'),
      resDist: qs('#resDist'),
      resUnit: qs('#resUnit'),
      resLine: qs('#resLine'),
      resIntent: qs('#resIntent'),
      resCoords: qs('#resCoords'),
      resStats: qs('#resStats'),
      btnNavigate: qs('#btnNavigate'),
      btnAgain: qs('#btnAgain'),
      btnShare: qs('#btnShare'),
      btnCopy: qs('#btnCopy'),
      arrivedH: qs('#arrivedH'),
      arrivedNote: qs('#arrivedNote'),
      btnSaveNote: qs('#btnSaveNote'),
      btnEndNav: qs('#btnEndNav'),
      btnLocate: qs('#btnLocate'),
      btnLayers: qs('#btnLayers'),
      btnJournal: qs('#btnJournal'),
      btnInfo: qs('#btnInfo'),
      btnExport: qs('#btnExport'),
      btnImport: qs('#btnImport'),
      importFile: qs('#importFile'),
      btnClear: qs('#btnClear')
    };

    loadPrefs();
    initMap();
    syncControls();
    bind();
    updateBadge();
    readUrl();
    measureSheet();

    if (!state.shared) {
      setStatus('Locating you\u2026');
      EW.nav.once();
    }

    EW.nav.on(handleNav);
    setTimeout(function () { EW.nav.start(); }, 1200);
  }

  /* ---- prefs ------------------------------------------------------ */
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS) || '{}');
      if (typeof p.radiusIdx === 'number' && p.radiusIdx >= 0 && p.radiusIdx < RADII.length) state.radiusIdx = p.radiusIdx;
      if (p.type && LABEL[p.type]) state.type = p.type;
      if (typeof p.intention === 'string') state.intention = p.intention;
      if (p.mapStyle === 'light' || p.mapStyle === 'dark') state.mapStyle = p.mapStyle;
    } catch (e) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({
        radiusIdx: state.radiusIdx, type: state.type,
        intention: state.intention, mapStyle: state.mapStyle
      }));
    } catch (e) {}
  }

  /* ---- map -------------------------------------------------------- */
  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      zoomSnap: 0.5,
      minZoom: 2,
      maxZoom: 19,
      maxBoundsViscosity: 0.2
    }).setView([24, 6], 2);

    var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    });
    markers.tiles = osm;
    osm.addTo(map);

    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
    applyMapStyle();

    markers.circle = L.circle([0, 0], {
      radius: 1000, color: '#d8ff3e', weight: 1, opacity: 0.16,
      fillColor: '#d8ff3e', fillOpacity: 0.02, dashArray: '3 8', interactive: false
    });

    markers.line = L.polyline([], {
      color: '#d8ff3e', weight: 1, opacity: 0.3, dashArray: '2 7', interactive: false
    });

    markers.origin = L.marker([0, 0], {
      icon: originIcon(), interactive: false, keyboard: false, zIndexOffset: 200
    });

    markers.target = L.marker([0, 0], {
      icon: targetIcon('attractor', 'Attractor'), interactive: false, keyboard: false, zIndexOffset: 400
    });

    map.on('click', function (e) {
      if (state.navMode) { toast('Stop navigating before moving the origin'); return; }
      setOrigin(e.latlng.lat, e.latlng.lng, 'map');
    });

    map.on('dragstart', function () {
      if (state.shared && !state.origin && state.current) {
        state.origin = { lat: state.current.lat, lon: state.current.lon };
      }
    });
  }

  function applyMapStyle() {
    el.map.classList.toggle('map-night', state.mapStyle === 'dark');
    el.btnLayers.classList.toggle('is-on', state.mapStyle === 'light');
  }

  function originIcon() {
    return L.divIcon({
      className: '',
      html: '<div class="mk"><div class="mk-origin"></div></div>',
      iconSize: [20, 20], iconAnchor: [10, 10]
    });
  }

  function targetIcon(type, label) {
    var c = COLOR[type] || COLOR.attractor;
    return L.divIcon({
      className: '',
      html: '<div class="mk mk-target" style="color:' + c + '">' +
            '<span class="pulse"></span><span class="ring"></span>' +
            '<span class="core"></span><span class="lbl">' + esc(label) + '</span></div>',
      iconSize: [56, 56], iconAnchor: [28, 28]
    });
  }

  /* ---- origin ----------------------------------------------------- */
  function setOrigin(lat, lon, source) {
    state.origin = { lat: lat, lon: lon };

    markers.origin.setLatLng([lat, lon]).addTo(map);
    markers.circle.setLatLng([lat, lon]).setRadius(RADII[state.radiusIdx]).addTo(map);

    if (state.navMode) finishNav(false);

    if (source !== 'silent') {
      map.flyTo([lat, lon], ZOOM[state.radiusIdx], { duration: 0.7 });
    }

    if (state.current && state.current.journalId) {
      markers.line.setLatLngs([[lat, lon], [state.current.lat, state.current.lon]]).addTo(map);
    }

    updateStatus();
    savePrefs();
  }

  function updateStatus() {
    if (!state.origin) {
      setStatus(state.geoDenied ? 'Location unavailable \u00b7 tap the map to choose a start point'
                                : 'Locating you\u2026');
      return;
    }
    if (!state.current) {
      var acc = (state.myPos && state.myPos.accuracy)
        ? ' \u00b7 \u00b1' + Math.round(state.myPos.accuracy) + ' m' : '';
      setStatus('Ready' + acc + ' \u00b7 ' + RADIUS_LABEL[state.radiusIdx] + ' radius');
    }
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  /* ---- generate --------------------------------------------------- */
  function generate() {
    if (!state.origin) {
      toast('Tap the map to choose where to search');
      flashSheet();
      return;
    }
    if (el.btnGenerate.classList.contains('is-busy')) return;

    el.btnGenerate.classList.add('is-busy');
    el.btnGenerate.setAttribute('aria-busy', 'true');
    el.btnGenerate.disabled = true;
    var t0 = performance.now();
    var rMax = RADII[state.radiusIdx];
    var rMin = Math.max(50, Math.round(rMax * 0.2));

    setTimeout(function () {
      var res;
      try {
        var u = EW.rng.uniforms(2 * EW.generator.SAMPLES);
        res = EW.generator.generate({
          lat: state.origin.lat,
          lon: state.origin.lon,
          rMin: rMin,
          rMax: rMax,
          type: state.type,
          uniforms: u,
          journal: EW.journal.load()
        });
      } catch (err) {
        el.btnGenerate.classList.remove('is-busy');
        el.btnGenerate.removeAttribute('aria-busy');
        el.btnGenerate.disabled = false;
        toast(err && err.message ? err.message : 'Generation failed');
        return;
      }

      var elapsed = performance.now() - t0;
      var wait = Math.max(0, 360 - elapsed);
      setTimeout(function () {
        el.btnGenerate.classList.remove('is-busy');
        el.btnGenerate.removeAttribute('aria-busy');
        el.btnGenerate.disabled = false;
        showResult(res);
      }, wait);
    }, 24);
  }

  function showResult(res) {
    state.arrivedOnce = false;
    state.current = res;

    var entry = {
      id: EW.journal.uid(),
      t: Date.now(),
      type: res.type,
      lat: res.lat,
      lon: res.lon,
      intention: state.intention,
      z: res.cell ? Math.round(res.cell.z * 100) / 100 : null,
      rMax: RADII[state.radiusIdx],
      note: '',
      arrived: false
    };
    EW.journal.add(entry);
    res.journalId = entry.id;
    updateBadge();

    placeTarget(res);
    renderResult(res);
    showPanel('result');
    fitToPoint();
    lookupPlace(res.lat, res.lon).then(function (name) {
      res.place = name || '';
      var ref = state.myPos || state.origin;
      if (name && ref && state.current === res && !state.navMode) {
        el.resLine.textContent = buildLine(G.bearing(ref, res), name);
      }
    });
  }

  function placeTarget(res) {
    markers.target.setIcon(targetIcon(res.type, res.label))
      .setLatLng([res.lat, res.lon])
      .addTo(map);

    // restart the drop animation
    var node = markers.target.getElement();
    if (node) {
      node.classList.remove('is-new');
      void node.offsetWidth;
      node.classList.add('is-new');
    }

    if (state.origin) {
      markers.line.setLatLngs([[state.origin.lat, state.origin.lon], [res.lat, res.lon]])
        .setStyle({ color: res.color || COLOR[res.type] })
        .addTo(map);
    }
  }

  function sheetHeight() {
    return Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')) || 0);
  }

  /* frame the point in the part of the map the sheet does not cover */
  function fitToPoint() {
    if (!state.current) return;
    var ll = [state.current.lat, state.current.lon];
    var bounds = state.origin
      ? L.latLngBounds([[state.origin.lat, state.origin.lon], ll])
      : L.latLngBounds([ll, ll]);
    map.flyToBounds(bounds, {
      paddingTopLeft: [72, 148],
      paddingBottomRight: [72, sheetHeight() + 62],
      maxZoom: 16,
      duration: 0.85
    });
  }

  function buildLine(bearing, placeName) {
    var cp = G.compassPoint(bearing);
    var s = 'bearing ' + Math.round(bearing) + '\u00b0 ' + cp;
    if (placeName) s += ' \u00b7 near ' + placeName;
    return s;
  }

  function renderResult(res) {
    var dist = displayDistance();
    var d = G.formatDistance(dist == null ? NaN : dist);

    el.resType.textContent = res.label || LABEL[res.type] || 'Point';
    el.resType.style.color = res.color || COLOR[res.type] || COLOR.attractor;

    if (res.cell && isFinite(res.cell.z)) {
      var z = res.cell.z;
      el.resZ.textContent = '\u03c3 ' + (z >= 0 ? '+' : '\u2212') + Math.abs(z).toFixed(2);
    } else {
      el.resZ.textContent = '\u03c3 --';
    }

    el.resDist.textContent = d.v;
    el.resUnit.textContent = d.u;

    var brg = (state.myPos || state.origin)
      ? G.bearing(state.myPos || state.origin, { lat: res.lat, lon: res.lon })
      : null;
    el.resLine.textContent = brg == null ? 'open the map to see where it falls'
                                         : buildLine(brg, '');

    if (res.intention) {
      el.resIntent.textContent = '\u201c' + res.intention + '\u201d';
      el.resIntent.hidden = false;
    } else {
      el.resIntent.hidden = true;
    }

    el.resCoords.textContent = G.formatCoord(res.lat, res.lon);

    if (res.stats) {
      var s = res.stats;
      el.resStats.textContent =
        nf(s.samples) + '\u00a0points \u00b7 ' + nf(s.cells) + '\u00a0squares \u00b7 ' +
        s.expected.toFixed(2) + '\u00a0expected \u00b7 p\u00a0' + fmtP(res.cell.p) + ' \u00b7 ' +
        s.ms + '\u00a0ms';
    } else if (res.cell && isFinite(res.cell.z)) {
      el.resStats.textContent = '\u03c3 ' + res.cell.z.toFixed(2);
    } else {
      el.resStats.textContent = '';
    }

    el.btnNavigate.textContent = 'NAVIGATE';
    document.body.dataset.nav = 'off';
  }

  function displayDistance() {
    if (!state.current) return null;
    if (state.myPos) return G.distance(state.myPos, state.current);
    if (state.origin) return G.distance(state.origin, state.current);
    return null;
  }

  /* ---- place names (best effort, never blocking) ------------------- */
  function lookupPlace(lat, lon) {
    var key = lat.toFixed(2) + ',' + lon.toFixed(2);
    if (Object.prototype.hasOwnProperty.call(placeCache, key)) {
      return Promise.resolve(placeCache[key]);
    }
    return new Promise(function (resolve) {
      var run = function () {
        lastPlaceQuery = Date.now();
        var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=' +
                  lat.toFixed(5) + '&lon=' + lon.toFixed(5);
        fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            var a = (j && j.address) || {};
            var name = a.village || a.hamlet || a.suburb || a.neighbourhood ||
                       a.town || a.city || a.municipality || a.county ||
                       (j && j.name) || '';
            placeCache[key] = name;
            resolve(name);
          })
          .catch(function () { placeCache[key] = ''; resolve(''); });
      };
      // be polite: one request per second at most
      var wait = Math.max(0, 1100 - (Date.now() - lastPlaceQuery));
      setTimeout(run, wait);
    });
  }

  /* ---- navigation -------------------------------------------------- */
  function handleNav(evt) {
    if (evt.type === 'pos') {
      var first = !state.myPos;
      state.myPos = evt.pos;
      if (first) {
        if (!state.origin && !state.shared) {
          setOrigin(evt.pos.lat, evt.pos.lon, 'gps');
        } else if (!state.origin && state.shared) {
          state.origin = { lat: evt.pos.lat, lon: evt.pos.lon };
          markers.origin.setLatLng([state.origin.lat, state.origin.lon]).addTo(map);
        }
      }
      updateLive();
    } else if (evt.type === 'heading') {
      state.heading = evt.heading;
      updateNeedle();
      el.navCompass.textContent = 'compass';
    } else if (evt.type === 'compass') {
      el.navCompass.textContent = 'compass';
    } else if (evt.type === 'error') {
      if (evt.code === 1) {
        state.geoDenied = true;
        setStatus('Location blocked \u00b7 tap the map to choose a start point');
        showNotice('Location is off, so Elsewhere cannot find you. Tap anywhere on the map to set the starting point.');
      }
    }
  }

  function updateLive() {
    if (!state.current) { updateStatus(); return; }

    var dist = displayDistance();
    var d = G.formatDistance(dist == null ? NaN : dist);
    el.resDist.textContent = d.v;
    el.resUnit.textContent = d.u;

    if (state.navMode && dist != null) {
      el.navDist.textContent = d.v;
      el.navUnit.textContent = d.u;

      var brg = G.bearing(state.myPos || state.origin, { lat: state.current.lat, lon: state.current.lon });
      el.navBearing.textContent = 'bearing ' + Math.round(brg) + '\u00b0 ' + G.compassPoint(brg);
      updateNeedle();

      var acc = state.myPos && state.myPos.accuracy ? state.myPos.accuracy : 20;
      var threshold = Math.max(20, Math.min(75, acc * 1.4));
      if (!state.arrivedOnce && dist <= threshold) {
        state.arrivedOnce = true;
        finishNav(true);
      }
    }
  }

  function updateNeedle() {
    if (!state.current) return;
    var from = state.myPos || state.origin;
    if (!from) return;
    var brg = G.bearing(from, { lat: state.current.lat, lon: state.current.lon });
    var rot = (state.heading == null) ? brg : (brg - state.heading);
    el.needle.style.transform = 'rotate(' + (rot % 360).toFixed(1) + 'deg)';
    if (state.heading == null) el.navCompass.textContent = 'no compass';
  }

  function startNav() {
    if (!state.current) return;
    if (state.navMode) { finishNav(false); return; }

    state.navMode = true;
    state.arrivedOnce = false;
    document.body.dataset.nav = 'on';
    el.navhud.hidden = false;
    el.btnNavigate.textContent = 'STOP';

    EW.nav.requestCompass().then(function (ok) {
      if (!ok) el.navCompass.textContent = 'no compass';
    });
    EW.nav.start();
    if (state.current.place) el.resLine.textContent = 'near ' + state.current.place;
    updateLive();
    updateNeedle();
    measureSheet();
  }

  function finishNav(arrived) {
    state.navMode = false;
    document.body.dataset.nav = 'off';
    el.navhud.hidden = true;
    EW.nav.stop();
    el.btnNavigate.textContent = 'NAVIGATE';

    var entry = currentEntry();
    if (arrived && entry) {
      EW.journal.update(entry.id, { arrived: true });
      updateBadge();
      el.arrivedH.textContent = 'Within ' + Math.round(Math.max(20, (state.myPos && state.myPos.accuracy) || 20)) + ' m of the point.';
      toast('You have arrived');
    } else {
      el.arrivedH.textContent = 'Log what you found.';
    }

    el.arrivedNote.value = entry ? (entry.note || '') : '';
    if (state.current) renderResult(state.current);
    showPanel('arrived');
  }

  function currentEntry() {
    if (!state.current || !state.current.journalId) return null;
    var list = EW.journal.load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.current.journalId) return list[i];
    }
    return null;
  }

  /* ---- panels ------------------------------------------------------ */
  function showPanel(name) {
    el.panels.forEach(function (p) {
      p.hidden = p.getAttribute('data-panel') !== name;
    });
    document.body.dataset.view = name;
    measureSheet();
  }

  function measureSheet() {
    var vis = qs('.panel:not([hidden])', el.sheet);
    var h = vis ? Math.round(vis.getBoundingClientRect().height) + 12 : 0;
    document.documentElement.style.setProperty('--sheet-h', h + 'px');
  }

  function flashSheet() {
    el.sheet.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }],
      { duration: 260, easing: 'ease-out' }
    );
  }

  /* ---- journal ------------------------------------------------------ */
  function updateBadge() {
    var n = EW.journal.load().length;
    el.journalBadge.textContent = n > 99 ? '99+' : String(n);
    el.journalBadge.hidden = n === 0;
    el.drawerSub.textContent = n
      ? n + ' point' + (n === 1 ? '' : 's') + ', kept only on this device.'
      : 'Points you generate will collect here. Nothing leaves this device.';
  }

  function renderJournal() {
    var list = EW.journal.load();
    el.journalList.textContent = '';

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'jempty';
      empty.textContent = 'Nothing yet. Generate a point and it will be recorded here, with whatever you write down when you get there.';
      el.journalList.appendChild(empty);
      return;
    }

    list.forEach(function (entry) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'jentry';

      var dot = document.createElement('span');
      dot.className = 'jentry__dot';
      dot.setAttribute('data-t', entry.type || 'attractor');

      var main = document.createElement('span');
      main.className = 'jentry__main';

      var intent = document.createElement('span');
      intent.className = 'jentry__intent' + (entry.intention ? '' : ' is-empty');
      intent.textContent = entry.intention || 'no intention set';

      var meta = document.createElement('span');
      meta.className = 'jentry__meta';
      var when = entry.t ? new Date(entry.t) : null;
      var bits = [
        (LABEL[entry.type] || 'Point'),
        when ? when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '',
        (RADIUS_LABEL[RADII.indexOf(entry.rMax)] || '')
      ].filter(Boolean);
      meta.textContent = bits.join(' \u00b7 ');

      main.appendChild(intent);
      main.appendChild(meta);

      if (entry.note) {
        var note = document.createElement('span');
        note.className = 'jentry__note';
        note.textContent = entry.note;
        main.appendChild(note);
      }

      var right = document.createElement('span');
      right.className = 'jentry__right';
      if (entry.arrived) {
        right.textContent = 'arrived';
        right.classList.add('jentry__arrived');
      } else if (state.myPos) {
        right.textContent = G.formatDistance(G.distance(state.myPos, entry)).v +
                            G.formatDistance(G.distance(state.myPos, entry)).u;
      }

      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(right);

      row.addEventListener('click', function () {
        openJournalEntry(entry);
      });

      el.journalList.appendChild(row);
    });
  }

  function openJournalEntry(entry) {
    closeDrawer('drawer');
    state.current = {
      lat: entry.lat, lon: entry.lon,
      type: entry.type, label: LABEL[entry.type] || 'Point',
      color: COLOR[entry.type] || COLOR.attractor,
      cell: entry.z != null ? { z: entry.z } : null,
      stats: null,
      journalId: entry.id,
      intention: entry.intention || ''
    };
    if (!state.origin) {
      state.origin = { lat: entry.lat, lon: entry.lon };
      markers.origin.setLatLng([entry.lat, entry.lon]).addTo(map);
    }
    placeTarget(state.current);
    renderResult(state.current);
    showPanel('result');
    fitToPoint();
  }

  /* ---- drawers ------------------------------------------------------ */
  function openDrawer(which) {
    var node = which === 'about' ? el.about : el.drawer;
    if (which === 'drawer') renderJournal();
    el.toast.classList.remove('is-up');
    node.hidden = false;
    document.body.style.overflow = 'hidden';
    var focusable = node.querySelector('button, a, [tabindex]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 40);
  }

  function closeDrawer(which) {
    var node = which === 'about' ? el.about : el.drawer;
    node.hidden = true;
    document.body.style.overflow = '';
  }

  function showNotice(text) {
    el.noticeText.textContent = text;
    el.notice.hidden = false;
  }

  /* ---- controls ----------------------------------------------------- */
  function syncControls() {
    el.intention.value = state.intention;
    el.radius.value = String(state.radiusIdx);
    paintRange();

    qsa('.seg__btn', el.typeSeg).forEach(function (b) {
      var on = b.getAttribute('data-type') === state.type;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function paintRange() {
    var pct = (state.radiusIdx / (RADII.length - 1)) * 100;
    el.radius.style.setProperty('--fill', pct + '%');
    el.radiusOut.textContent = RADIUS_LABEL[state.radiusIdx];
    el.radius.setAttribute('aria-valuetext', RADIUS_LABEL[state.radiusIdx]);
  }

  function setType(t) {
    if (!LABEL[t]) return;
    state.type = t;
    syncControls();
    savePrefs();
  }

  function setRadius(idx) {
    state.radiusIdx = Math.max(0, Math.min(RADII.length - 1, idx));
    paintRange();
    if (state.origin) {
      markers.circle.setRadius(RADII[state.radiusIdx]);
      map.flyTo([state.origin.lat, state.origin.lon], ZOOM[state.radiusIdx], { duration: 0.5 });
    }
    savePrefs();
  }

  /* ---- url ---------------------------------------------------------- */
  function readUrl() {
    var params = new URLSearchParams(location.search);
    var p = params.get('p');
    if (!p) return;

    var parts = p.split(',');
    var lat = parseFloat(parts[0]), lon = parseFloat(parts[1]);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

    var t = params.get('t');
    if (LABEL[t]) state.type = t;
    var i = params.get('i');
    if (i) state.intention = i.slice(0, 90);

    state.shared = true;
    state.current = {
      lat: lat, lon: lon,
      type: LABEL[t] ? t : 'attractor',
      label: LABEL[t] || 'Point',
      color: COLOR[t] || COLOR.attractor,
      cell: params.get('z') ? { z: parseFloat(params.get('z')) } : null,
      stats: null,
      journalId: null,
      intention: state.intention
    };
    syncControls();
    placeTarget(state.current);
    renderResult(state.current);
    showPanel('result');
    fitToPoint();
    setStatus('Shared point \u00b7 generate your own any time');
  }

  function shareUrl() {
    if (!state.current) return '';
    var q = 'p=' + state.current.lat.toFixed(6) + ',' + state.current.lon.toFixed(6) +
            '&t=' + encodeURIComponent(state.current.type);
    if (state.current.cell && isFinite(state.current.cell.z)) q += '&z=' + state.current.cell.z.toFixed(2);
    if (state.current.intention) q += '&i=' + encodeURIComponent(state.current.intention.slice(0, 90));
    return location.origin + location.pathname + '?' + q;
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || 'Copied'); };
    var fail = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else { fail(); }
  }

  function download(text, filename) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  /* ---- events -------------------------------------------------------- */
  function bind() {
    el.intention.addEventListener('input', function () {
      state.intention = el.intention.value.slice(0, 90);
      savePrefs();
    });

    el.typeSeg.addEventListener('click', function (e) {
      var b = e.target.closest('.seg__btn');
      if (b) setType(b.getAttribute('data-type'));
    });

    el.radius.addEventListener('input', function () {
      setRadius(parseInt(el.radius.value, 10));
    });

    el.btnGenerate.addEventListener('click', generate);
    el.btnAgain.addEventListener('click', generate);
    el.btnNavigate.addEventListener('click', startNav);

    el.btnShare.addEventListener('click', function () {
      var url = shareUrl();
      if (url) copyText(url, 'Link copied');
    });

    el.btnCopy.addEventListener('click', function () {
      if (!state.current) return;
      copyText(state.current.lat.toFixed(6) + ',' + state.current.lon.toFixed(6), 'Coordinates copied');
    });

    el.btnLocate.addEventListener('click', function () {
      var p = state.myPos || EW.nav.position();
      if (p) {
        map.flyTo([p.lat, p.lon], 16, { duration: 0.7 });
        toast('Back to you');
      } else {
        toast('No fix yet');
        EW.nav.once();
      }
    });

    el.btnLayers.addEventListener('click', function () {
      state.mapStyle = state.mapStyle === 'dark' ? 'light' : 'dark';
      applyMapStyle();
      savePrefs();
      toast(state.mapStyle === 'light' ? 'Standard map' : 'Night map');
    });

    el.btnJournal.addEventListener('click', function () { openDrawer('drawer'); });
    el.btnInfo.addEventListener('click', function () { openDrawer('about'); });

    qsa('[data-close]').forEach(function (n) {
      n.addEventListener('click', function () { closeDrawer(n.getAttribute('data-close')); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.drawer.hidden) closeDrawer('drawer');
        else if (!el.about.hidden) closeDrawer('about');
      }
    });

    el.btnSaveNote.addEventListener('click', function () {
      var entry = currentEntry();
      if (entry) {
        EW.journal.update(entry.id, {
          note: el.arrivedNote.value.slice(0, 500),
          arrived: true
        });
        updateBadge();
        toast('Saved');
      } else {
        toast('Nothing to save');
      }
      showPanel('result');
    });

    el.btnEndNav.addEventListener('click', function () { showPanel('result'); });

    el.btnExport.addEventListener('click', function () {
      var list = EW.journal.load();
      if (!list.length) { toast('Journal is empty'); return; }
      download(EW.journal.exportText(), 'elsewhere-journal-' + new Date().toISOString().slice(0, 10) + '.json');
      toast('Exported ' + list.length + ' points');
    });

    el.btnImport.addEventListener('click', function () { el.importFile.click(); });

    el.importFile.addEventListener('change', function () {
      var f = el.importFile.files && el.importFile.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = EW.journal.importText(String(reader.result));
          renderJournal();
          updateBadge();
          toast(n ? 'Imported ' + n : 'Nothing new to import');
        } catch (err) {
          toast(err.message || 'Import failed');
        }
      };
      reader.readAsText(f);
      el.importFile.value = '';
    });

    el.btnClear.addEventListener('click', function () {
      var list = EW.journal.load();
      if (!list.length) { toast('Journal is empty'); return; }
      if (!confirm('Delete all ' + list.length + ' points from this device? This cannot be undone.')) return;
      EW.journal.clear();
      renderJournal();
      updateBadge();
      toast('Journal cleared');
    });

    el.noticeClose.addEventListener('click', function () { el.notice.hidden = true; });

    window.addEventListener('resize', measureSheet);
    window.addEventListener('orientationchange', function () { setTimeout(measureSheet, 250); });

    if ('ResizeObserver' in window) {
      new ResizeObserver(measureSheet).observe(el.sheet);
    }

    window.addEventListener('keydown', function (e) {
      if (e.key === 'g' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        generate();
      }
    });
  }

  /* ---- go ------------------------------------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* service worker, only on the deployed origin */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
