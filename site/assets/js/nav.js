/* ============================================================
   nav.js — position watch and compass
   ============================================================ */
(function (global) {
  'use strict';

  var watchId = null;
  var pos = null;
  var heading = null;
  var headingLive = false;
  var bound = false;
  var listeners = [];

  function emit(evt) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](evt); } catch (e) { /* a bad listener must not stop the rest */ }
    }
  }

  function on(e) { if (listeners.indexOf(e) === -1) listeners.push(e); }
  function off(e) { var i = listeners.indexOf(e); if (i > -1) listeners.splice(i, 1); }

  function onPos(p) {
    pos = {
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      accuracy: isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
      heading: isFinite(p.coords.heading) ? p.coords.heading : null,
      t: p.timestamp || Date.now()
    };
    emit({ type: 'pos', pos: pos });
  }

  function onErr(err) {
    emit({ type: 'error', code: err && err.code, message: err && err.message });
  }

  function start() {
    if (!navigator.geolocation) return false;
    if (watchId !== null) return true;
    try {
      watchId = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true, maximumAge: 1000, timeout: 25000
      });
    } catch (e) { return false; }
    return true;
  }

  function stop() {
    if (watchId !== null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
      watchId = null;
    }
  }

  function once() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(onPos, onErr, {
      enableHighAccuracy: true, timeout: 12000, maximumAge: 60000
    });
  }

  /* ---- compass -------------------------------------------------- */
  function blend(a, b, w) {
    var d = ((b - a + 540) % 360) - 180;
    return (a + d * w + 360) % 360;
  }

  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) {
      h = e.webkitCompassHeading;                                   // iOS
    } else if ((e.type === 'deviceorientationabsolute' || e.absolute === true) &&
               typeof e.alpha === 'number' && isFinite(e.alpha)) {
      h = (360 - e.alpha) % 360;                                    // absolute alpha
    }
    if (h === null) return;

    heading = (heading === null) ? h : blend(heading, h, 0.34);
    if (!headingLive) { headingLive = true; emit({ type: 'compass', live: true }); }
    emit({ type: 'heading', heading: heading });
  }

  function bindCompass() {
    if (bound) return;
    bound = true;
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
  }

  /* must be called from a user gesture on iOS */
  function requestCompass() {
    var DOE = global.DeviceOrientationEvent;
    if (!DOE) return Promise.resolve(false);

    if (typeof DOE.requestPermission === 'function') {
      return DOE.requestPermission().then(function (res) {
        if (res !== 'granted') return false;
        bindCompass();
        return true;
      }).catch(function () { return false; });
    }
    bindCompass();
    return Promise.resolve(true);
  }

  global.EW = global.EW || {};
  global.EW.nav = {
    start: start, stop: stop, once: once,
    on: on, off: off,
    requestCompass: requestCompass,
    position: function () { return pos; },
    heading: function () { return heading; },
    hasCompass: function () { return headingLive; }
  };
})(window);
