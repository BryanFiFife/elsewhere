/* ============================================================
   app.js — the whole UI
   ============================================================ */
(function () {
  'use strict';

  var EW = window.EW;
  var G = EW.geo;

  var RADII = [250, 500, 1000, 3000, 8000];
  var RADIUS_LABEL = ['250 m', '500 m', '1 km', '3 km', '8 km'];
  var ZOOM = [16, 15.5, 15, 13, 12];
  var LABEL = {
    attractor: 'Attractor', void: 'Void', random: 'Random', blind: 'Blind spot',
    nearby: 'Nearby', landmark: 'Landmark'
  };
  var COLOR = {
    attractor: '#d8ff3e', void: '#8f74ff', random: '#c9c7c0',
    blind: '#ffb03a', nearby: '#35d0e0', landmark: '#ff7a9c'
  };
  var NEAR_METRES = 300;
  var MAX_DOTS = 420;
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
    geoDenied: false,
    locateShown: false,
    originName: '',
    places: [],
    placesError: null,
    placesLoading: false,
    placesFetchedAt: 0,
    showDots: true
  };

  var placesTimer = null;
  var placesToken = 0;

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
      btnClear: qs('#btnClear'),
      resPlace: qs('#resPlace'),
      placesRow: qs('#placesRow'),
      placesCount: qs('#placesCount'),
      placesPulse: qs('#placesPulse'),
      btnPlaces: qs('#btnPlaces'),
      btnPlacesDots: qs('#btnPlacesDots'),
      placesDrawer: qs('#places'),
      placesList: qs('#placesList'),
      placesSub: qs('#placesSub'),
      placeSearch: qs('#placeSearch'),
      btnPlacesRefresh: qs('#btnPlacesRefresh'),
      btnPlacesClear: qs('#btnPlacesClear'),
      btnBack: qs('#btnBack'),
      btnLastPoint: qs('#btnLastPoint'),
      btnRecentre: qs('#btnRecentre'),
      locateBlock: qs('#locateBlock'),
      locateForm: qs('#locateForm'),
      locateInput: qs('#locateInput'),
      locateMsg: qs('#locateMsg'),
      btnUseLocation: qs('#btnUseLocation'),
      live: qs('#live'),
      resCaveat: qs('#resCaveat')
    };

    el.panels = qsa('.panel');
    el.panels.forEach(function (p) { p.tabIndex = -1; });
    el.placesRow.hidden = true;
    el.locateBlock.hidden = true;

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
      setTimeout(function () {
        if (!state.origin) showLocate('Search for a place, or zoom in and tap the map.');
      }, 5000);
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

    markers.poiRenderer = L.canvas({ padding: 0.4 });
    markers.poiLayer = L.layerGroup();

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
    el.map.classList.toggle('zoom-far', state.mapStyle === 'dark' && map.getZoom() < 6);
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
    if (source === 'map' && map.getZoom() < 9) {
      toast('Zoom in first \u2014 tap a town, not a continent');
      showLocate('Zoom into the map, then tap. Or search for a place.');
      return;
    }

    state.origin = { lat: lat, lon: lon };
    state.originName = '';
    state.locateShown = false;
    syncOriginUI();

    markers.origin.setLatLng([lat, lon]).addTo(map);
    markers.circle.setLatLng([lat, lon]).setRadius(RADII[state.radiusIdx]).addTo(map);

    if (state.navMode) finishNav(false);

    if (source !== 'silent') {
      map.setView([lat, lon], ZOOM[state.radiusIdx], { animate: false });
    }

    if (state.current && state.current.journalId) {
      markers.line.setLatLngs([[lat, lon], [state.current.lat, state.current.lon]]).addTo(map);
    }

    updateStatus();
    savePrefs();
    schedulePlaces(600);
    reverseOriginLabel();
  }

  /* a place name for the search centre, so the status line says where */
  function reverseOriginLabel() {
    if (!state.origin) return;
    var lat = state.origin.lat, lon = state.origin.lon;
    lookupPlace(lat, lon).then(function (name) {
      if (!name || !state.origin) return;
      if (Math.abs(state.origin.lat - lat) > 1e-6 || Math.abs(state.origin.lon - lon) > 1e-6) return;
      state.originName = name;
      updateStatus();
    }).catch(function () {});
  }

  function updateStatus() {
    if (!state.origin) {
      setStatus(state.geoDenied ? 'Location blocked \u00b7 search for a place'
                                : 'Locating you\u2026');
      return;
    }
    if (!state.current) {
      var acc = (state.myPos && state.myPos.accuracy)
        ? ' \u00b7 \u00b1' + Math.round(state.myPos.accuracy) + ' m' : '';
      var name = state.originName ? ' \u00b7 ' + state.originName : '';
      setStatus('Ready' + name + acc + ' \u00b7 ' + RADIUS_LABEL[state.radiusIdx]);
    }
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  /* ---- known places ------------------------------------------------ */
  function setPlacesPulse(mode) {
    el.placesPulse.className = 'places__pulse' + (mode ? ' is-' + mode : '');
  }

  function schedulePlaces(ms) {
    clearTimeout(placesTimer);
    placesTimer = setTimeout(function () { refreshPlaces(false); }, ms == null ? 650 : ms);
  }

  function refreshPlaces(force) {
    if (!state.origin) return Promise.resolve(state.places);
    if (state.placesLoading) return Promise.resolve(state.places);

    var origin = { lat: state.origin.lat, lon: state.origin.lon };
    var radius = RADII[state.radiusIdx];
    var token = ++placesToken;

    state.placesLoading = true;
    updatePlacesRow();

    return EW.places.ensure(origin, radius, { force: !!force }).then(function (res) {
      if (token !== placesToken) return state.places;
      state.placesLoading = false;
      state.places = res.places || [];
      state.placesFetchedAt = res.fetchedAt || 0;
      state.placesError = res.error || null;
      updatePlacesRow();
      renderPlaceDots();
      // a point generated before the places arrived can still be annotated
      if (state.current && state.current.stats && !state.current.place && state.current.type !== 'landmark') {
        var np = nearestPlaceTo(state.current);
        if (np) { state.current.place = np; paintPlaceLine(state.current); }
      }
      if (!el.placesDrawer.hidden) renderPlacesList();
      return state.places;
    }).catch(function (err) {
      if (token !== placesToken) return state.places;
      state.placesLoading = false;
      state.placesError = String((err && err.message) || err);
      updatePlacesRow();
      return state.places;
    });
  }

  function updatePlacesRow() {
    var n = state.places.length;
    if (state.placesLoading) {
      setPlacesPulse('busy');
      el.placesCount.textContent = n ? 'Updating known places\u2026' : 'Searching for known places\u2026';
      return;
    }
    if (state.placesError) {
      setPlacesPulse('off');
      el.placesCount.textContent = n
        ? n.toLocaleString('en-GB') + ' places \u00b7 stored copy'
        : 'Known places unavailable';
      return;
    }
    setPlacesPulse(n ? 'live' : 'off');
    el.placesCount.textContent = n
      ? n.toLocaleString('en-GB') + (n === 1 ? ' known place \u00b7 ' : ' known places \u00b7 ') + RADIUS_LABEL[state.radiusIdx]
      : 'No known places within ' + RADIUS_LABEL[state.radiusIdx];
  }

  /* small dots for every known place, with the nearest one lit */
  function renderPlaceDots() {
    if (!markers.poiLayer) return;
    markers.poiLayer.clearLayers();

    if (!state.showDots || !state.places.length) {
      if (map.hasLayer(markers.poiLayer)) map.removeLayer(markers.poiLayer);
      return;
    }

    var list = state.places.slice(0, MAX_DOTS);
    var hotId = null;

    if (state.current) {
      var best = Infinity;
      for (var i = 0; i < list.length; i++) {
        var d = G.distance(state.current, list[i]);
        if (d < best) { best = d; hotId = list[i].id; }
      }
    }

    var liveTo = Math.min(list.length, 160);
    for (var j = 0; j < list.length; j++) {
      var p = list[j];
      var hot = p.id === hotId;
      var clickable = j < liveTo;
      var mk = L.circleMarker([p.lat, p.lon], {
        renderer: markers.poiRenderer,
        radius: hot ? 5 : (clickable ? 3.1 : 2.3),
        weight: hot ? 1.6 : (clickable ? 1 : 0),
        color: hot ? '#35d0e0' : 'rgba(207,202,187,.5)',
        opacity: hot ? 1 : (clickable ? 0.7 : 0),
        fillColor: hot ? '#35d0e0' : '#cfcabb',
        fillOpacity: hot ? 0.95 : (clickable ? 0.44 : 0.26),
        interactive: clickable
      });
      if (clickable) {
        mk.bindTooltip(p.name, { direction: 'top', offset: [0, -7], className: 'poi-tip' });
        (function (place) {
          mk.on('click', function (e) {
            if (e.originalEvent) L.DomEvent.stopPropagation(e);
            toast(place.name);
          });
        })(p);
      }
      mk.addTo(markers.poiLayer);
    }

    if (!map.hasLayer(markers.poiLayer)) markers.poiLayer.addTo(map);
  }

  function renderPlacesList() {
    var q = (el.placeSearch.value || '').trim().toLowerCase();
    var list = state.places.filter(function (p) {
      return !q || String(p.name).toLowerCase().indexOf(q) > -1;
    });

    el.placesSub.textContent = state.places.length
      ? state.places.length.toLocaleString('en-GB') + ' known places within ' + RADIUS_LABEL[state.radiusIdx] +
        (q ? ' \u00b7 ' + list.length + ' matching' : '')
      : 'Nothing found in this radius yet.';

    el.placesList.textContent = '';

    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'jempty';
      empty.textContent = state.places.length
        ? 'No place matches that filter.'
        : 'Move the map or widen the radius and the app will ask again.';
      el.placesList.appendChild(empty);
      return;
    }

    list.slice(0, 250).forEach(function (p) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'jentry';

      var dot = document.createElement('span');
      dot.className = 'jentry__dot';
      dot.setAttribute('data-t', 'place');

      var main = document.createElement('span');
      main.className = 'jentry__main';
      var name = document.createElement('span');
      name.className = 'jentry__intent';
      name.textContent = p.name;
      main.appendChild(name);

      var right = document.createElement('span');
      right.className = 'jentry__right';
      var from = state.myPos || state.origin;
      var d = from ? G.formatDistance(G.distance(from, p)) : { v: '', u: '' };
      right.textContent = d.v + d.u;

      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(right);
      row.addEventListener('click', function () {
        closeDrawer('places');
        map.flyTo([p.lat, p.lon], 17, { duration: 0.8 });
        toast(p.name);
      });
      el.placesList.appendChild(row);
    });
  }

  /* ---- generate --------------------------------------------------- */
  function setBusy(on) {
    el.btnGenerate.classList.toggle('is-busy', !!on);
    if (on) el.btnGenerate.setAttribute('aria-busy', 'true');
    else el.btnGenerate.removeAttribute('aria-busy');
    el.btnGenerate.disabled = !!on;
  }

  function generate() {
    if (!state.origin) {
      toast('Search for a place, or zoom in and tap the map');
      showLocate('Search for a place, or zoom in and tap the map.');
      flashSheet();
      return;
    }
    if (el.btnGenerate.classList.contains('is-busy')) return;

    var needsPlaces = state.type === 'landmark' || state.type === 'nearby';
    if (needsPlaces && !state.places.length && !state.placesError) {
      setBusy(true);
      refreshPlaces(true).then(function () {
        setBusy(false);
        if (!state.places.length) { toast('No known places here yet'); return; }
        runGenerate();
      });
      return;
    }
    runGenerate();
  }

  function runGenerate() {
    setBusy(true);
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
          journal: EW.journal.load(),
          places: state.places,
          near: state.type === 'nearby' ? NEAR_METRES : 0
        });
      } catch (err) {
        setBusy(false);
        toast(err && err.message ? err.message : 'Generation failed');
        return;
      }

      var elapsed = performance.now() - t0;
      var wait = Math.max(0, 160 - elapsed);
      setTimeout(function () {
        setBusy(false);
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
    renderPlaceDots();

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

  function nearestPlaceTo(pt) {
    var best = null, bd = Infinity;
    for (var i = 0; i < state.places.length; i++) {
      var d = G.distance(pt, state.places[i]);
      if (d < bd) { bd = d; best = state.places[i]; }
    }
    return best ? { name: best.name, url: best.url || '', d: bd } : null;
  }

  function paintPlaceLine(res) {
    if (!res || !res.place || !res.place.name) { el.resPlace.hidden = true; return; }
    el.resPlace.textContent = '';

    var lbl = document.createElement('i');
    lbl.textContent = res.type === 'landmark' ? 'known place' : 'nearest place';
    var nm = document.createElement('b');
    nm.textContent = res.place.name;

    el.resPlace.appendChild(lbl);
    el.resPlace.appendChild(nm);

    if (res.place.d > 1) {
      var dd = document.createElement('span');
      dd.textContent = Math.round(res.place.d) + ' m away';
      el.resPlace.appendChild(dd);
    }
    el.resPlace.title = res.place.name;
    el.resPlace.hidden = false;
  }

  /* frame the point in the part of the map the sheet does not cover */
  function fitToPoint() {
    if (!state.current) return;
    var ll = [state.current.lat, state.current.lon];
    var bounds = state.origin
      ? L.latLngBounds([[state.origin.lat, state.origin.lon], ll])
      : L.latLngBounds([ll, ll]);

    // measure the panel itself rather than trusting a cached CSS variable
    var vis = qs('.panel:not([hidden])', el.sheet);
    var size = map.getSize();
    var panelH = vis ? Math.round(vis.getBoundingClientRect().height)
                     : Math.round(size.y * 0.34);

    var padTop = Math.min(130 + (el.notice.hidden ? 0 : Math.round(el.notice.getBoundingClientRect().height) + 14),
                          Math.round(size.y * 0.34));
    var padBottom = Math.min(panelH + 100, Math.round(size.y * 0.62));

    // framed instantly: an animated flight can be left half-finished if the
    // tab is busy or backgrounded, and the point would sit under the sheet
    map.fitBounds(bounds, {
      paddingTopLeft: [72, padTop],
      paddingBottomRight: [72, padBottom],
      maxZoom: 16,
      animate: false
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

    paintPlaceLine(res);

    if (res.caveat) {
      el.resCaveat.textContent = res.caveat;
      el.resCaveat.hidden = false;
    } else {
      el.resCaveat.hidden = true;
    }

    el.resCoords.textContent = G.formatCoord(res.lat, res.lon);

    if (res.stats) {
      var s = res.stats;
      var bits = [nf(s.samples) + '\u00a0points', nf(s.cells) + '\u00a0squares'];
      if (s.places > 0) bits.push(nf(s.places) + '\u00a0known');
      bits.push('p\u00a0' + fmtP(res.cell.p));
      el.resStats.textContent = bits.join(' \u00b7 ');
      if (res.nearFallback) {
        el.resStats.textContent += ' \u00b7 no known place in reach, unconstrained';
      }
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
          syncOriginUI();
          schedulePlaces(400);
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
      // gets fired twice: once for the initial fix, once for the watch
      if (evt.code === 1 && !state.geoDenied) {
        state.geoDenied = true;
        setStatus('Location blocked \u00b7 search for a place');
        showLocate('Location is blocked. Search for a place, or zoom in and tap the map.');
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
    el.btnNavigate.textContent = 'I\u2019M HERE';

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
    announce(arrived ? 'You have arrived at the point.' : 'Navigation ended.');
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
    el.btnLastPoint.hidden = !(name === 'controls' && !!state.current);
    measureSheet();
    updateRecentre();

    var now = qs('.panel:not([hidden])', el.sheet);
    if (now && document.activeElement && now.contains(document.activeElement) === false) {
      try { now.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function announce(msg) {
    if (!el.live) return;
    el.live.textContent = '';
    setTimeout(function () { el.live.textContent = msg; }, 40);
  }

  /* a pill that appears when the point has drifted out of the clear area */
  function updateRecentre() {
    if (!state.current || state.navMode || document.body.dataset.view !== 'result') {
      el.btnRecentre.classList.remove('is-up');
      return;
    }
    var pt = map.latLngToContainerPoint([state.current.lat, state.current.lon]);
    var size = map.getSize();
    var vis = qs('.panel:not([hidden])', el.sheet);
    var floor = vis ? vis.getBoundingClientRect().top - 12 : size.y;

    var inside = pt.x > 44 && pt.x < size.x - 44 && pt.y > 84 && pt.y < floor;
    el.btnRecentre.classList.toggle('is-up', !inside);
  }

  /* ---- locating without GPS ---------------------------------------- */
  function syncOriginUI() {
    var has = !!state.origin;
    el.placesRow.hidden = !has;
    el.locateBlock.hidden = has || !state.locateShown;
    measureSheet();
  }

  function showLocate(msg) {
    if (state.origin) return;
    state.locateShown = true;
    if (msg) el.locateMsg.textContent = msg;
    syncOriginUI();
  }

  function searchPlace(q) {
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q);
    return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!list || !list.length) return null;
        var hit = list[0];
        var lat = parseFloat(hit.lat), lon = parseFloat(hit.lon);
        if (!isFinite(lat) || !isFinite(lon)) return null;
        return { lat: lat, lon: lon, name: String(hit.display_name || '').split(',')[0].trim() };
      });
  }

  function measureSheet() {
    var vis = qs('.panel:not([hidden])', el.sheet);
    if (!vis) return;                     // never zero the variable on a transient
    var h = Math.round(vis.getBoundingClientRect().height) + 12;
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

      var wrap = document.createElement('div');
      wrap.className = 'jrow';

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'jdel';
      del.setAttribute('aria-label', 'Delete this point');
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        EW.journal.remove(entry.id);
        if (state.current && state.current.journalId === entry.id) state.current.journalId = null;
        renderJournal();
        updateBadge();
        toast('Point deleted');
      });

      wrap.appendChild(row);
      wrap.appendChild(del);
      el.journalList.appendChild(wrap);
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
  function drawerNode(which) {
    if (which === 'about') return el.about;
    if (which === 'places') return el.placesDrawer;
    return el.drawer;
  }

  function openDrawer(which) {
    var node = drawerNode(which);
    if (which === 'drawer') renderJournal();
    if (which === 'places') renderPlacesList();
    el.toast.classList.remove('is-up');
    node.hidden = false;
    document.body.style.overflow = 'hidden';
    var focusable = node.querySelector('button, a, [tabindex]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 40);
  }

  function closeDrawer(which) {
    drawerNode(which).hidden = true;
    document.body.style.overflow = '';
  }

  function showNotice(text) {
    el.noticeText.textContent = text;
    el.notice.hidden = false;
    clearTimeout(showNotice._t);
    showNotice._t = setTimeout(function () { el.notice.hidden = true; }, 14000);
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
      b.tabIndex = on ? 0 : -1;
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
    schedulePlaces(500);
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

    /* --- back and forth between settings and the point --- */
    el.btnBack.addEventListener('click', function () { showPanel('controls'); });

    el.btnLastPoint.addEventListener('click', function () {
      if (!state.current) return;
      showPanel('result');
      fitToPoint();
    });

    el.btnRecentre.addEventListener('click', function () { fitToPoint(); updateRecentre(); });

    /* --- setting a location without GPS --- */
    el.locateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = el.locateInput.value.trim();
      if (!q) return;
      el.locateMsg.textContent = 'Searching\u2026';
      searchPlace(q).then(function (hit) {
        if (!hit) {
          el.locateMsg.textContent = 'Nothing found for that. Try a town or a postcode.';
          return;
        }
        el.locateMsg.textContent = '';
        el.locateInput.blur();
        setOrigin(hit.lat, hit.lon, 'search');
        state.originName = hit.name;
        updateStatus();
        announce('Searching around ' + hit.name);
      }).catch(function () {
        el.locateMsg.textContent = 'Search unavailable. Zoom in and tap the map instead.';
      });
    });

    el.btnUseLocation.addEventListener('click', function () {
      state.geoDenied = false;
      el.locateMsg.textContent = 'Asking for your location\u2026';
      EW.nav.once();
      setTimeout(function () {
        if (!state.origin && !state.geoDenied) {
          el.locateMsg.textContent = 'No fix yet. Search for a place, or tap the map.';
        }
      }, 12000);
    });

    /* --- keyboard --- */
    el.intention.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); generate(); }
    });

    el.typeSeg.addEventListener('keydown', function (e) {
      var keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
      if (keys.indexOf(e.key) === -1) return;
      e.preventDefault();
      var btns = qsa('.seg__btn', el.typeSeg);
      var i = btns.indexOf(document.activeElement);
      if (i < 0) i = btns.indexOf(qs('.seg__btn.is-on', el.typeSeg));
      var next = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % btns.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'End') next = btns.length - 1;
      else next = 0;
      btns[next].focus();
      setType(btns[next].getAttribute('data-type'));
    });

    map.on('moveend zoomend', updateRecentre);
    map.on('zoomend', applyMapStyle);

    window.addEventListener('offline', function () {
      showNotice('You are offline. The map and known places will not load until you reconnect.');
    });
    window.addEventListener('online', function () {
      el.notice.hidden = true;
      if (state.origin) schedulePlaces(400);
    });
    if (navigator.onLine === false) {
      showNotice('You are offline. The map and known places will not load until you reconnect.');
    }

    el.btnPlaces.addEventListener('click', function () { openDrawer('places'); });

    el.btnPlacesDots.addEventListener('click', function () {
      state.showDots = !state.showDots;
      el.btnPlacesDots.classList.toggle('is-on', state.showDots);
      el.btnPlacesDots.setAttribute('aria-pressed', state.showDots ? 'true' : 'false');
      renderPlaceDots();
    });

    el.placeSearch.addEventListener('input', renderPlacesList);

    el.btnPlacesRefresh.addEventListener('click', function () {
      refreshPlaces(true).then(function () {
        toast(state.places.length ? 'Known places refreshed' : 'Still nothing here');
      });
    });

    el.btnPlacesClear.addEventListener('click', function () {
      if (!confirm('Remove every stored known place from this device?')) return;
      EW.places.forget().then(function () {
        state.places = [];
        state.placesError = null;
        updatePlacesRow();
        renderPlaceDots();
        renderPlacesList();
        toast('Cleared');
      });
    });

    qsa('[data-close]').forEach(function (n) {
      n.addEventListener('click', function () { closeDrawer(n.getAttribute('data-close')); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!el.drawer.hidden) closeDrawer('drawer');
        else if (!el.placesDrawer.hidden) closeDrawer('places');
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
