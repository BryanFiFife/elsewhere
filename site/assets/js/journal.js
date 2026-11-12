/* ============================================================
   journal.js — local-only history
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'elsewhere.journal.v1';
  var CAP = 600;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(valid);
    } catch (e) { return []; }
  }

  function valid(e) {
    return e && typeof e === 'object' &&
      isFinite(e.lat) && isFinite(e.lon) &&
      Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180;
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
      return true;
    } catch (e) { return false; }
  }

  function add(entry) {
    var list = load();
    list.unshift(entry);
    if (list.length > CAP) list.length = CAP;
    save(list);
    return list;
  }

  function update(id, patch) {
    var list = load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k];
        break;
      }
    }
    save(list);
    return list;
  }

  function remove(id) {
    var list = load().filter(function (e) { return e.id !== id; });
    save(list);
    return list;
  }

  function clear() { save([]); return []; }

  function exportText() {
    return JSON.stringify({
      app: 'elsewhere',
      version: 1,
      exported: new Date().toISOString(),
      points: load()
    }, null, 2);
  }

  /* merge, de-duplicating on id; returns count added */
  function importText(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    var incoming = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.points) ? parsed.points : null);
    if (!incoming) throw new Error('No points found in that file.');

    var list = load();
    var seen = {};
    for (var i = 0; i < list.length; i++) seen[list[i].id] = true;

    var added = 0;
    for (var j = 0; j < incoming.length; j++) {
      var e = incoming[j];
      if (!valid(e)) continue;
      if (!e.id) e.id = uid();
      if (seen[e.id]) continue;
      seen[e.id] = true;
      list.push(e);
      added++;
    }
    list.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    if (list.length > CAP) list.length = CAP;
    save(list);
    return added;
  }

  function uid() {
    var b = new Uint8Array(8);
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
    var s = '';
    for (var k = 0; k < b.length; k++) s += ('0' + b[k].toString(16)).slice(-2);
    return Date.now().toString(36) + '-' + s;
  }

  global.EW = global.EW || {};
  global.EW.journal = {
    load: load, save: save, add: add, update: update, remove: remove,
    clear: clear, exportText: exportText, importText: importText, uid: uid
  };
})(window);
