/* ============================================================
   generator.js — the anomaly test, with known places folded in

   Scatter N points uniformly through an annulus, rasterise into a
   grid, and score each grid square against the count a uniform
   scatter would produce there. Squares holding far more or far
   fewer than expected are genuine statistical outliers.

   Known places come in as an array ({name, lat, lon, ...}). They
   are projected into the same plane, so a place can be:
     - the destination itself (landmark),
     - a constraint on which squares are eligible (nearby),
     - an annotation on any result (nearest place).
   ============================================================ */
(function (global) {
  'use strict';

  var SAMPLES = 42000;
  var GRID = 96;

  var META = {
    attractor: { label: 'Attractor', color: '#d8ff3e' },
    void:      { label: 'Void',      color: '#8f74ff' },
    random:    { label: 'Random',    color: '#c9c7c0' },
    blind:     { label: 'Blind spot', color: '#ffb03a' },
    nearby:    { label: 'Nearby',    color: '#35d0e0' },
    landmark:  { label: 'Landmark',  color: '#ff7a9c' }
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
    var places = opts.places || [];
    var nearDist = opts.near > 0 ? Math.min(opts.near, rMax) : 0;

    if (!u || u.length < 2 * N) throw new Error('Not enough entropy for the scatter.');
    if (!isFinite(lat0) || !isFinite(lon0)) throw new Error('No origin.');

    var rMin2 = rMin * rMin, rMax2 = rMax * rMax;
    var span = rMax2 - rMin2;

    /* ---- 1. scatter ---------------------------------------- */
    var xs = new Float64Array(N), ys = new Float64Array(N);
    for (var i = 0; i < N; i++) {
      var r = Math.sqrt(rMin2 + span * u[2 * i]);
      var th = 6.283185307179586 * u[2 * i + 1];
      xs[i] = r * Math.cos(th);
      ys[i] = r * Math.sin(th);
    }

    /* ---- 2. rasterise --------------------------------------- */
    var G = GRID;
    var cell = (2 * rMax) / G;
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

    /* ---- 3. score ------------------------------------------- */
    var annulusArea = Math.PI * span;
    var expected = N * (cell * cell) / annulusArea;
    if (!(expected >= 1)) throw new Error('Grid too fine for this radius.');
    var sd = Math.sqrt(expected);

    var posIdx = [];      // every square with more points than expected
    var zeroIdx = [];     // every square with none
    var maxCount = 0;
    var eligible = 0;

    for (var gy = 0; gy < G; gy++) {
      var ya = -rMax + gy * cell, yb = ya + cell;
      var ny = 0; if (ya > 0) ny = ya; else if (yb < 0) ny = yb;
      var fy = Math.max(Math.abs(ya), Math.abs(yb));

      for (var gx = 0; gx < G; gx++) {
        var xa = -rMax + gx * cell, xb = xa + cell;
        var nx = 0; if (xa > 0) nx = xa; else if (xb < 0) nx = xb;
        var fx = Math.max(Math.abs(xa), Math.abs(xb));

        if (nx * nx + ny * ny < rMin2) continue;          // inside the hole
        if (fx * fx + fy * fy > rMax2) continue;          // outside the ring

        eligible++;
        var idx = gy * G + gx;
        var c = counts[idx];
        if (c > expected) posIdx.push(idx);
        else if (c === 0) zeroIdx.push(idx);
        if (c > maxCount) maxCount = c;
      }
    }

    if (eligible < 64) throw new Error('Not enough scored cells. Widen the radius.');

    // z is monotone in count, so sorting by count sorts by z
    posIdx.sort(function (a, b) { return counts[b] - counts[a]; });

    /* ---- 4. known places, projected into the same plane ------ */
    var PL = [];
    for (var pi = 0; pi < places.length; pi++) {
      var pl = places[pi];
      if (!pl || !isFinite(pl.lat) || !isFinite(pl.lon)) continue;
      var off = global.EW.geo.latLonToOffset(lat0, lon0, pl.lat, pl.lon);
      if (off.x * off.x + off.y * off.y > rMax2) continue;
      var pcx = Math.floor((off.x + rMax) / cell);
      var pcy = Math.floor((off.y + rMax) / cell);
      if (pcx < 0) pcx = 0; else if (pcx >= G) pcx = G - 1;
      if (pcy < 0) pcy = 0; else if (pcy >= G) pcy = G - 1;
      PL.push({ p: pl, x: off.x, y: off.y, k: pcy * G + pcx });
    }

    /* squares within nearDist of at least one known place */
    var mask = null;
    if (nearDist > 0 && PL.length) {
      mask = new Uint8Array(cells2);
      var ring = Math.max(1, Math.ceil(nearDist / cell));
      for (var ai = 0; ai < PL.length; ai++) {
        var q = PL[ai];
        var qcx = q.k % G, qcy = (q.k - qcx) / G;
        for (var dy = -ring; dy <= ring; dy++) {
          var g2 = qcy + dy;
          if (g2 < 0 || g2 >= G) continue;
          var ccy = -rMax + (g2 + 0.5) * cell;
          for (var dx = -ring; dx <= ring; dx++) {
            var g1 = qcx + dx;
            if (g1 < 0 || g1 >= G) continue;
            var ccx = -rMax + (g1 + 0.5) * cell;
            var ex = ccx - q.x, ey = ccy - q.y;
            if (ex * ex + ey * ey <= nearDist * nearDist) mask[g2 * G + g1] = 1;
          }
        }
      }
    }

    /* ---- 5. choose ------------------------------------------ */
    var chosen = -1;
    // asked to stay near a place, but there is none: say so rather than
    // quietly handing back an unconstrained point
    var nearFallback = (nearDist > 0 && PL.length === 0);
    var landmark = null;

    if (type === 'landmark') {
      landmark = pickLandmark(PL, counts, expected, sd, u[0]);
      if (!landmark) throw new Error('No known places in range. Widen the radius or move the map.');
      chosen = landmark.k;

    } else if (type === 'void') {
      var pool = zeroIdx;
      if (mask) {
        var mp = [];
        for (var vi = 0; vi < zeroIdx.length; vi++) if (mask[zeroIdx[vi]]) mp.push(zeroIdx[vi]);
        if (mp.length) pool = mp; else nearFallback = true;
      }
      if (!pool.length) throw new Error('No void cell found.');
      chosen = pool[Math.floor(u[0] * pool.length) % pool.length];

    } else if (type === 'random') {
      var pick = -1;
      for (var at = 0; at < 96; at++) {
        var cand = Math.floor(u[at % u.length] * N) % N;
        var ccx2 = Math.floor((xs[cand] + rMax) / cell);
        var ccy2 = Math.floor((ys[cand] + rMax) / cell);
        if (ccx2 < 0) ccx2 = 0; else if (ccx2 >= G) ccx2 = G - 1;
        if (ccy2 < 0) ccy2 = 0; else if (ccy2 >= G) ccy2 = G - 1;
        var ck = ccy2 * G + ccx2;
        if (!mask || mask[ck]) { pick = cand; chosen = ck; break; }
      }
      if (pick < 0) { nearFallback = true; pick = Math.floor(u[0] * N) % N; chosen = -1; }
      if (chosen < 0) {
        var bx = Math.floor((xs[pick] + rMax) / cell), by = Math.floor((ys[pick] + rMax) / cell);
        if (bx < 0) bx = 0; else if (bx >= G) bx = G - 1;
        if (by < 0) by = 0; else if (by >= G) by = G - 1;
        chosen = by * G + bx;
      }

    } else if (type === 'blind') {
      var top = [];
      for (var bi = 0; bi < posIdx.length && top.length < 48; bi++) {
        if (mask && !mask[posIdx[bi]]) continue;
        top.push(posIdx[bi]);
      }
      if (!top.length) { nearFallback = !!(mask && posIdx.length); top = posIdx.slice(0, 1); }
      if (!top.length) throw new Error('No attractor found.');
      chosen = pickBlind(top, sumX, sumY, counts, cell, rMax, G, lat0, lon0, opts.journal || []);

    } else {
      // attractor and nearby share a search; nearby just carries a mask
      var found = -1;
      for (var ti = 0; ti < posIdx.length; ti++) {
        if (mask && !mask[posIdx[ti]]) continue;
        found = posIdx[ti];
        break;
      }
      if (found < 0) { nearFallback = !!(mask && posIdx.length); found = posIdx.length ? posIdx[0] : -1; }
      if (found < 0) throw new Error('No attractor found.');
      chosen = found;
    }

    /* ---- 6. representative coordinate ------------------------ */
    var offX, offY;

    if (type === 'landmark') {
      offX = landmark.x;
      offY = landmark.y;
    } else if (type === 'random') {
      offX = xs[pick]; offY = ys[pick];
    } else if (counts[chosen] > 0) {
      offX = sumX[chosen] / counts[chosen];
      offY = sumY[chosen] / counts[chosen];
    } else {
      var mcx = (chosen % G) + 0.5, mcy = Math.floor(chosen / G) + 0.5;
      offX = -rMax + mcx * cell;
      offY = -rMax + mcy * cell;
    }

    var ll = type === 'landmark'
      ? { lat: landmark.p.lat, lon: landmark.p.lon }
      : global.EW.geo.offsetToLatLon(lat0, lon0, offX, offY);

    var dist = global.EW.geo.distance({ lat: lat0, lon: lon0 }, ll);
    var brg = global.EW.geo.bearing({ lat: lat0, lon: lon0 }, ll);

    /* ---- 7. nearest known place ----------------------------- */
    var nearest = null, bestD2 = Infinity;
    for (var ni = 0; ni < PL.length; ni++) {
      var ddx = PL[ni].x - offX, ddy = PL[ni].y - offY;
      var d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD2) { bestD2 = d2; nearest = PL[ni]; }
    }

    var count = counts[chosen];
    var chosenZ = (count - expected) / sd;
    var p = normUpperTail(chosenZ);
    var t1 = (global.performance && performance.now) ? performance.now() : Date.now();

    var placeOut = null;
    if (type === 'landmark') {
      placeOut = { name: landmark.p.name, url: landmark.p.url || '', d: 0 };
    } else if (nearest) {
      placeOut = { name: nearest.p.name, url: nearest.p.url || '', d: Math.sqrt(bestD2) };
    }

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
      place: placeOut,
      nearFallback: nearFallback,
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
        places: PL.length,
        placesInRange: places.length,
        near: nearDist || 0,
        zMax: posIdx.length ? (counts[posIdx[0]] - expected) / sd : 0,
        expectationOfThisExtreme: eligible * normUpperTail(Math.abs(chosenZ)) / 2,
        ms: Math.round((t1 - t0) * 10) / 10,
        grid: G
      }
    };
  }

  /* a known place, weighted towards squares the scatter runs hot in */
  function pickLandmark(PL, counts, expected, sd, u) {
    if (!PL.length) return null;
    var weights = new Array(PL.length);
    var total = 0;
    for (var i = 0; i < PL.length; i++) {
      var z = (counts[PL[i].k] - expected) / sd;
      var w = 0.12 + Math.max(0, z + 1.6) / 4.2;
      weights[i] = w;
      total += w;
    }
    var r = u * total, acc = 0;
    for (var j = 0; j < PL.length; j++) {
      acc += weights[j];
      if (r <= acc) return PL[j];
    }
    return PL[PL.length - 1];
  }

  /* highest-surplus square that sits furthest from anything journalled */
  function pickBlind(top, sumX, sumY, counts, cell, rMax, G, lat0, lon0, journal) {
    if (!top.length) return -1;

    var pts = [];
    for (var i = 0; i < top.length; i++) {
      var k = top[i];
      var x, y;
      if (counts[k] > 0) { x = sumX[k] / counts[k]; y = sumY[k] / counts[k]; }
      else {
        x = -rMax + ((k % G) + 0.5) * cell;
        y = -rMax + ((Math.floor(k / G)) + 0.5) * cell;
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
