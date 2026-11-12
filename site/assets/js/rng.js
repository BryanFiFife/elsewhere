/* ============================================================
   rng.js — entropy
   Uses the platform CSPRNG. Nothing is sent anywhere.
   ============================================================ */
(function (global) {
  'use strict';

  var c = (typeof crypto !== 'undefined' && crypto && crypto.getRandomValues) ? crypto : null;
  var TWO32 = 4294967296;

  function available() { return !!c; }

  /**
   * n uniforms in [0,1), from the platform CSPRNG.
   * 32 bits of entropy per value; no modulo bias (divide, don't reduce).
   */
  function uniforms(n) {
    if (!c) throw new Error('No cryptographic random source in this browser.');
    var out = new Float64Array(n);
    var CHUNK = 8192;
    var buf = new Uint32Array(CHUNK);
    var i = 0;
    while (i < n) {
      var take = Math.min(CHUNK, n - i);
      var view = take === CHUNK ? buf : buf.subarray(0, take);
      c.getRandomValues(view);
      for (var k = 0; k < take; k++) out[i + k] = buf[k] / TWO32;
      i += take;
    }
    return out;
  }

  function uniformInt(maxExclusive) {
    if (!c) throw new Error('No cryptographic random source in this browser.');
    var b = new Uint32Array(1);
    // rejection sampling keeps it unbiased
    var limit = TWO32 - (TWO32 % maxExclusive);
    var v;
    do { c.getRandomValues(b); v = b[0]; } while (v >= limit);
    return v % maxExclusive;
  }

  global.EW = global.EW || {};
  global.EW.rng = {
    available: available,
    uniforms: uniforms,
    uniformInt: uniformInt,
    label: 'crypto.getRandomValues'
  };
})(window);
