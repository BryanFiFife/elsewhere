/* ============================================================
   generator.js — the anomaly test

   Scatter N points uniformly through an annulus, rasterise into a
   grid, and score each grid square against the count a uniform
   scatter would produce there. Squares that hold far more or far
   fewer than expected are genuine statistical outliers.

   Only squares lying entirely inside the annulus are scored, so
   the expected count per square is exactly N * cellArea / area.
   ============================================================ */
(function (global) {
  'use strict';

  var SAMPLES = 42000;
  var GRID = 96;
  var TOP_K = 48;

  var META = {
    attractor: { label: 'Attractor', color: '#d8ff3e' },
    void:      { label: 'Void',      color: '#8f74ff' },
    random:    { label: 'Random',    color: '#c9c7c0' },
    blind:     { label: 'Blind spot', color: '#ffb03a' }
  };

  /* Abramowitz & Stegun 7.1.26 */
  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  function normUpperTail(z) {
    return 0.5 * (1 - erf(z / Math.SQRT2));
  }

  function generate(opts) {
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();

    var lat0 = opts.lat, lon0 = opts.lon;
    var rMax = Math.max(50, opts.rMax);
    var rMin = Math.max(0, Math.min(opts.rMin, rMax * 0.95));
    var type = META[opts.type] ? opts.type : 'attractor';
    var u = opts.uniforms;
    var N = SAMPLES;

    if (!u || u.length < 2 * N) throw new Error('Not enough entropy for the scatter.');
    if (!isFinite(lat0) || !isFinite(lon0)) throw new Error('No origin.');

    var rMin2 = rMin * rMin, rMax2 = rMax * rMax;
    var span = rMax2 - rMin2;

    /* ---- 1. scatter --------------------------------------- */
    var xs = new Float64Array(N), ys = new Float64Array(N);
    for (var i = 0; i < N; i++) {
      var r = Math.sqrt(rMin2 + span * u[2 * i]);
      var th = 6.283185307179586 * u[2 * i + 1];
      xs[i] = r * Math.cos(th);
      ys[i] = r * Math.sin(th);
    }

    /* ---- 2. rasterise ------------------------------------- */
    var G = GRID;
    var size = 2 * rMax;
    var cell = size / G;
    var cells2 = G * G;
    var counts = new Uint32Array(cells2);
    var sumX = new Float64Array(cells2);
    var sumY = new Float64Array(cells2);

    for (var j = 0; j < N; j++) {
      var cx = Math.floor((xs[j] + rMax) / cell);
      var cy = Math.floor((ys[j] + rMax) / cell);
      if (cx < 0) cx = 0; else if (cx >= G) cx = G - 1;
      if (cy < 0) cy = 0; else if (cy >= G) cy = G - 1;
      var k = cy * G + cx;
      counts[k]++;
      sumX[k] += xs[j];
      sumY[k] += ys[j];
    }

    /* ---- 3. score ----------------------------------------- */
    var annulusArea = Math.PI * span;
    var cellArea = cell * cell;
    var expected = N * cellArea / annulusArea;
    if (!(expected >= 1)) throw new Error('Grid too fine for this radius.');
    var sd = Math.sqrt(expected);

    var top = [];          // best-|z| positive cells, descending
    var minZ = Infinity, maxZ = -Infinity;
    var eligible = 0;
    var ties = [];         // cells sharing the minimum z

    for (var gy = 0; gy < G; gy++) {
      var ya = -rMax + gy * cell, yb = ya + cell;
      var ny = 0; if (ya > 0) ny = ya; else if (yb < 0) ny = yb;
      var fy = Math.max(Math.abs(ya), Math.abs(yb));

      for (var gx = 0; gx < G; gx++) {
        var xa = -rMax + gx * cell, xb = xa + cell;
        var nx = 0; if (xa > 0) nx = xa; else if (xb < 0) nx = xb;
        var fx = Math.max(Math.abs(xa), Math.abs(xb));

        // nearest point of the square to origin / farthest corner
        if (nx * nx + ny * ny < rMin2) continue;
        if (fx * fx + fy * fy > rMax2) continue;

        eligible++;
        var idx = gy * G + gx;
        var z = (counts[idx] - expected) / sd;

        if (z > maxZ) maxZ = z;
        if (z < minZ - 1e-9) { minZ = z; ties.length = 0; ties.push(idx); }
        else if (z <= minZ + 1e-9) { ties.push(idx); }

        if (z > 0) {
          if (top.length < TOP_K) {
            top.push({ k: idx, z: z });
            top.sort(byZDesc);
          } else if (z > top[TOP_K - 1].z) {
            top[TOP_K - 1] = { k: idx, z: z };
            top.sort(byZDesc);
          }
        }
      }
    }

    if (eligible < 64) throw new Error('Not enough scored cells. Widen the radius.');

    /* ---- 4. choose ---------------------------------------- */
    var chosen = -1;
    var chosenZ = 0;

    if (type === 'void') {
      // zero-count squares all tie exactly; pick among them at random
      chosen = ties.length ? ties[Math.floor(u[0] * ties.length) % ties.length] : -1;
      if (chosen < 0) throw new Error('No void cell found.');
      chosenZ = (counts[chosen] - expected) / sd;
    } else if (type === 'random') {
      var pick = Math.floor(u[0] * N) % N;
      var rcx = Math.floor((xs[pick] + rMax) / cell);
      var rcy = Math.floor((ys[pick] + rMax) / cell);
      if (rcx < 0) rcx = 0; else if (rcx >= G) rcx = G - 1;
      if (rcy < 0) rcy = 0; else if (rcy >= G) rcy = G - 1;
      chosen = rcy * G + rcx;
      chosenZ = (counts[chosen] - expected) / sd;
    } else if (type === 'blind') {
      chosen = pickBlind(top, sumX, sumY, counts, cell, rMax, G, lat0, lon0, opts.journal || [], xs, ys);
      if (chosen < 0) throw new Error('No candidate found.');
      chosenZ = (counts[chosen] - expected) / sd;
    } else {
      if (!top.length) throw new Error('No attractor found.');
      chosen = top[0].k;
      chosenZ = top[0].z;
    }

    /* ---- 5. representative coordinate --------------------- */
    var offX, offY;
    if (type === 'random') {
      offX = xs[pick]; offY = ys[pick];
    } else if (counts[chosen] > 0) {
      offX = sumX[chosen] / counts[chosen];
      offY = sumY[chosen] / counts[chosen];
    } else {
      var ccx = (chosen % G) + 0.5, ccy = Math.floor(chosen / G) + 0.5;
      offX = -rMax + ccx * cell;
      offY = -rMax + ccy * cell;
    }

    var ll = global.EW.geo.offsetToLatLon(lat0, lon0, offX, offY);
    var dist = global.EW.geo.distance({ lat: lat0, lon: lon0 }, ll);
    var brg = global.EW.geo.bearing({ lat: lat0, lon: lon0 }, ll);

    var count = counts[chosen];
    var p = normUpperTail(chosenZ);
    var t1 = (global.performance && performance.now) ? performance.now() : Date.now();

    return {
      ok: true,
      type: type,
      label: META[type].label,
      color: META[type].color,
      lat: ll.lat,
      lon: ll.lon,
      offset: { x: offX, y: offY },
      distance: dist,
      bearing: brg,
      cell: {
        count: count,
        expected: expected,
        z: chosenZ,
        p: p,
        sigma: Math.abs(chosenZ)
      },
      pot: powerOfTwo(count),
      stats: {
        samples: N,
        cells: eligible,
        expected: expected,
        zMax: maxZ,
        zMin: minZ,
        expectationOfThisExtreme: eligible * normUpperTail(Math.abs(chosenZ)) / 2,
        ms: Math.round((t1 - t0) * 10) / 10,
        grid: G
      }
    };
  }

  function byZDesc(a, b) { return b.z - a.z; }

  /* highest-surplus square that sits furthest from anything journalled */
  function pickBlind(top, sumX, sumY, counts, cell, rMax, G, lat0, lon0, journal, xs, ys) {
    if (!top.length) return -1;

    var pts = [];
    for (var i = 0; i < top.length; i++) {
      var k = top[i].k;
      var x, y;
      if (counts[k] > 0) { x = sumX[k] / counts[k]; y = sumY[k] / counts[k]; }
      else {
        x = -rMax + ((k % G) + 0.5) * cell;
        y = -rMax + (Math.floor(k / G) + 0.5) * cell;
      }
      pts.push({ k: k, ll: global.EW.geo.offsetToLatLon(lat0, lon0, x, y) });
    }

    if (!journal.length) return pts[0].k;

    var best = pts[0].k, bestD = -1;
    for (var a = 0; a < pts.length; a++) {
      var minD = Infinity;
      for (var b = 0; b < journal.length; b++) {
        var e = journal[b];
        if (!e || !isFinite(e.lat) || !isFinite(e.lon)) continue;
        var d = global.EW.geo.distance(pts[a].ll, { lat: e.lat, lon: e.lon });
        if (d < minD) minD = d;
      }
      if (minD > bestD) { bestD = minD; best = pts[a].k; }
    }
    return best;
  }

  function powerOfTwo(n) {
    if (!n || n < 1) return null;
    var n2 = Math.round(Math.log2(n));
    var target = Math.pow(2, n2);
    return { exponent: n2, value: target, delta: Math.abs(n - target) };
  }

  global.EW = global.EW || {};
  global.EW.generator = {
    generate: generate,
    SAMPLES: SAMPLES,
    GRID: GRID,
    META: META,
    _normUpperTail: normUpperTail
  };
})(window);
