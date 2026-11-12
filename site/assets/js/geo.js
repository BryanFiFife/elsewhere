/* ============================================================
   geo.js — spherical maths, no dependencies
   ============================================================ */
(function (global) {
  'use strict';

  var R_EARTH = 6371008.8;
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  function rad(d) { return d * D2R; }
  function deg(r) { return r * R2D; }

  /* metres per degree of latitude (WGS84, sub-metre accurate) */
  function mPerDegLat(lat) {
    var p = rad(lat);
    return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  }

  /* metres per degree of longitude */
  function mPerDegLon(lat) {
    var p = rad(lat);
    return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  }

  function distance(a, b) {
    var dLat = rad(b.lat - a.lat);
    var dLon = rad(b.lon - a.lon);
    var la1 = rad(a.lat), la2 = rad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* initial great-circle bearing, degrees clockwise from north */
  function bearing(a, b) {
    var la1 = rad(a.lat), la2 = rad(b.lat), dLon = rad(b.lon - a.lon);
    var y = Math.sin(dLon) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  /* move `d` metres from `origin` along `brg` degrees */
  function destination(origin, d, brg) {
    var la1 = rad(origin.lat), lo1 = rad(origin.lon), t = rad(brg), dr = d / R_EARTH;
    var la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(t));
    var lo2 = lo1 + Math.atan2(Math.sin(t) * Math.sin(dr) * Math.cos(la1),
                               Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
    return { lat: deg(la2), lon: ((deg(lo2) + 540) % 360) - 180 };
  }

  /* local tangent-plane offset (east, north) in metres -> lat/lon */
  function offsetToLatLon(lat0, lon0, dx, dy) {
    var lat = lat0 + dy / mPerDegLat(lat0);
    var lon = lon0 + dx / mPerDegLon((lat0 + lat) / 2);
    return { lat: lat, lon: normalizeLon(lon) };
  }

  function latLonToOffset(lat0, lon0, lat, lon) {
    return {
      x: (lon - lon0) * mPerDegLon((lat0 + lat) / 2),
      y: (lat - lat0) * mPerDegLat((lat0 + lat) / 2)
    };
  }

  function normalizeLon(lon) {
    if (lon > 180) return lon - 360;
    if (lon < -180) return lon + 360;
    return lon;
  }

  /* distance readout -> {v: "1.24", u: "km"} */
  function formatDistance(m) {
    if (!isFinite(m)) return { v: '--', u: '' };
    if (m < 20) return { v: m.toFixed(1), u: 'm' };
    if (m < 1000) return { v: String(Math.round(m)), u: 'm' };
    var km = m / 1000;
    if (km < 10) return { v: km.toFixed(2), u: 'km' };
    if (km < 100) return { v: km.toFixed(1), u: 'km' };
    return { v: String(Math.round(km)), u: 'km' };
  }

  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  function compassPoint(d) {
    return COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
  }

  function formatCoord(lat, lon) {
    var ns = lat >= 0 ? 'N' : 'S';
    var ew = lon >= 0 ? 'E' : 'W';
    return Math.abs(lat).toFixed(5) + '° ' + ns + '  ' + Math.abs(lon).toFixed(5) + '° ' + ew;
  }

  global.EW = global.EW || {};
  global.EW.geo = {
    distance: distance,
    bearing: bearing,
    destination: destination,
    offsetToLatLon: offsetToLatLon,
    latLonToOffset: latLonToOffset,
    formatDistance: formatDistance,
    compassPoint: compassPoint,
    formatCoord: formatCoord
  };
})(window);
