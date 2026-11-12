/* ELSEWHERE — end-to-end check
   Runs the real page in real Chrome, exercises the generator and the UI,
   and fails loudly with evidence. Exit code 1 on any failure. */

const path = require('path');
const fs = require('fs');

const PUPPETEER_CANDIDATES = [
  'C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core',
  'C:/Users/bryan/AppData/Local/npm-cache/_npx/node_modules/puppeteer-core'
];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8787/';
const OUT = path.join(__dirname, '..', 'qa');

let puppeteer = null;
for (const p of PUPPETEER_CANDIDATES) if (fs.existsSync(p)) { puppeteer = require(p); break; }
if (!puppeteer) { console.error('FATAL: puppeteer-core not found'); process.exit(1); }
if (!fs.existsSync(CHROME)) { console.error('FATAL: Chrome not found'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); }
}
const note = m => console.log('  ' + m);

async function clickEl(page, sel) {
  try {
    await page.click(sel);
    return 'mouse';
  } catch (e) {
    await page.evaluate(s => document.querySelector(s).click(), sel);
    return 'evaluate (mouse refused: ' + e.message.split('\n')[0] + ')';
  }
}

async function dumpState(page, label) {
  const s = await page.evaluate(() => ({
    view: document.body.dataset.view,
    nav: document.body.dataset.nav,
    status: (document.querySelector('#status') || {}).textContent,
    dist: (document.querySelector('#resDist') || {}).textContent,
    type: (document.querySelector('#resType') || {}).textContent,
    cta: (document.querySelector('#btnGenerate') || {}).className,
    disabled: (document.querySelector('#btnGenerate') || {}).disabled,
    errs: window.__errs || []
  }));
  console.log('  STATE(' + label + '): ' + JSON.stringify(s));
}

async function shot(page, name) {
  await page.evaluate(() => { if (window.gc) window.gc(); });
  await new Promise(r => setTimeout(r, 450));
  await page.screenshot({ path: path.join(OUT, name), captureBeyondViewport: false });
  console.log('  shot: qa/' + name);
}

/* This headless renderer starves requestAnimationFrame, so every
   waitForFunction must poll on a timer or it never evaluates. */
function hardenPage(page) {
  const orig = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, opts, ...rest) => {
    const base = (opts && typeof opts === 'object') ? opts : (typeof opts === 'number' ? { timeout: opts } : {});
    return orig(fn, Object.assign({ polling: 100, timeout: 20000 }, base), ...rest);
  };
  return page;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 90000,
    args: ['--no-sandbox', '--disable-features=ServiceWorker', '--hide-scrollbars']
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(new URL(BASE).origin, ['geolocation']);

    const page = hardenPage(await browser.newPage());
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 8 });

    const consoleErrors = [];
    page.on('console', m => {
      if (m.type() === 'error') consoleErrors.push(m.text() + ' <<' + ((m.location() && m.location().url) || '') + '>>');
    });
    page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + e.message));

    /* ── 1. load ─────────────────────────────────────────────────── */
    console.log('\n[1] load');
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      window.__errs = [];
      window.addEventListener('error', e => window.__errs.push(e.message + ' @' + (e.filename || '') + ':' + e.lineno));
    });
    await page.waitForFunction(
      () => /Ready|radius|blocked|unavailable/i.test(document.querySelector('#status').textContent),
      { timeout: 25000 }
    );

    check('title', (await page.title()).includes('ELSEWHERE'));
    check('leaflet loaded', await page.evaluate(() => typeof L !== 'undefined' && !!document.querySelector('.leaflet-container')));
    check('modules present', await page.evaluate(() =>
      !!(window.EW && EW.geo && EW.rng && EW.generator && EW.journal && EW.nav)));
    check('origin marker placed', await page.evaluate(() => !!document.querySelector('.mk-origin')));

    let tile = null;
    try {
      await page.waitForFunction(() => {
        const t = document.querySelector('.leaflet-tile');
        return t && t.complete && t.naturalWidth > 0;
      }, { timeout: 20000 });
    } catch (e) { /* recorded by the checks below */ }
    tile = await page.evaluate(() => {
      const t = document.querySelector('.leaflet-tile');
      return t ? { w: t.naturalWidth, h: t.naturalHeight, src: t.src } : null;
    });
    note('tile: ' + (tile ? tile.w + 'x' + tile.h + ' ' + tile.src.replace(/^https:\/\//, '') : 'none'));
    check('map tile actually rendered', !!tile && tile.w > 0, JSON.stringify(tile));
    check('tiles come from keyless OSM', !!tile && /^https:\/\/tile\.openstreetmap\.org\//.test(tile.src), tile && tile.src);
    check('nav hud hidden before navigating', await page.evaluate(() =>
      getComputedStyle(document.querySelector('#navhud')).display === 'none'));
    check('journal badge hidden at zero', await page.evaluate(() =>
      getComputedStyle(document.querySelector('#journalBadge')).display === 'none'));
    check('notice hidden at start', await page.evaluate(() =>
      getComputedStyle(document.querySelector('#notice')).display === 'none'));

    const status = await page.$eval('#status', n => n.textContent);
    note('status: ' + status);
    check('geolocation resolved', /Ready/i.test(status), status);

    const hit = await page.evaluate(() => {
      const b = document.querySelector('#btnGenerate');
      const r = b.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        self: !!t && (t === b || b.contains(t)),
        top: t ? t.tagName + '.' + t.className : null,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        vh: window.innerHeight
      };
    });
    note('cta at ' + JSON.stringify(hit.rect) + ' topmost=' + hit.top);
    check('cta is topmost at its own centre', hit.self, JSON.stringify(hit));
    check('cta sits inside the viewport', hit.rect[1] > 0 && hit.rect[1] + hit.rect[3] <= hit.vh, JSON.stringify(hit.rect));

    /* ── 2. generator, many runs — own tab, destroyed afterwards ──── */
    console.log('\n[2] generator statistics');
    const statPage = hardenPage(await browser.newPage());
    await statPage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await statPage.waitForFunction(() => !!(window.EW && window.EW.generator), { timeout: 20000 });
    const stats = await statPage.evaluate(() => {
      const origin = { lat: 55.9533, lon: -3.1883 };
      const radii = [[50, 250], [200, 1000], [600, 3000], [4000, 20000]];
      const types = ['attractor', 'void', 'random', 'blind'];
      const out = { runs: 0, violations: [], badZ: [], notFinite: [], attractorZ: [], voidZ: [], ms: [], expectedErr: [], meta: [], deterministic: null };

      for (const rc of radii) {
        for (const t of types) {
          for (let n = 0; n < 8; n++) {
            const u = EW.rng.uniforms(2 * EW.generator.SAMPLES);
            const res = EW.generator.generate({
              lat: origin.lat, lon: origin.lon, rMin: rc[0], rMax: rc[1], type: t, uniforms: u, journal: []
            });
            out.runs++;
            const d = EW.geo.distance(origin, { lat: res.lat, lon: res.lon });
            if (!(d >= rc[0] - 0.5 && d <= rc[1] + 0.5)) out.violations.push({ t, d: +d.toFixed(2) });
            if (!isFinite(res.lat) || !isFinite(res.lon)) out.notFinite.push(t);
            if (t === 'attractor' && !(res.cell.z > 0)) out.badZ.push({ t, z: res.cell.z });
            if (t === 'void' && !(res.cell.z < 0)) out.badZ.push({ t, z: res.cell.z });
            if (t === 'attractor') out.attractorZ.push(res.cell.z);
            if (t === 'void') out.voidZ.push(res.cell.z);

            const cellArea = Math.pow((2 * rc[1]) / EW.generator.GRID, 2);
            const expect = EW.generator.SAMPLES * cellArea / (Math.PI * (rc[1] * rc[1] - rc[0] * rc[0]));
            out.expectedErr.push(Math.abs(expect - res.stats.expected));
            out.ms.push(res.stats.ms);
            if (n === 0) out.meta.push({ r: rc[1], expected: +res.stats.expected.toFixed(3), cells: res.stats.cells });
          }
        }
      }

      const u = EW.rng.uniforms(2 * EW.generator.SAMPLES);
      const a = EW.generator.generate({ lat: origin.lat, lon: origin.lon, rMin: 200, rMax: 1000, type: 'attractor', uniforms: u, journal: [] });
      const b = EW.generator.generate({ lat: origin.lat, lon: origin.lon, rMin: 200, rMax: 1000, type: 'attractor', uniforms: u, journal: [] });
      out.deterministic = (a.lat === b.lat && a.lon === b.lon);
      return out;
    });
    await statPage.close();

    const meanA = stats.attractorZ.reduce((a, b) => a + b, 0) / stats.attractorZ.length;
    const meanV = stats.voidZ.reduce((a, b) => a + b, 0) / stats.voidZ.length;
    note('runs: ' + stats.runs);
    note('attractor sigma mean ' + meanA.toFixed(2) + ', min ' + Math.min.apply(null, stats.attractorZ).toFixed(2));
    note('void sigma mean ' + meanV.toFixed(2) + ', max ' + Math.max.apply(null, stats.voidZ).toFixed(2));
    note('slowest generation ' + Math.max.apply(null, stats.ms).toFixed(1) + ' ms');
    note('expected per square ' + stats.meta.map(m => m.expected).join(', '));
    note('scored cells ' + stats.meta[0].cells + ' of ' + (96 * 96));

    check('generator ran', stats.runs === 128, String(stats.runs));
    check('every point inside its ring', stats.violations.length === 0, JSON.stringify(stats.violations.slice(0, 4)));
    check('every coordinate finite', stats.notFinite.length === 0, JSON.stringify(stats.notFinite.slice(0, 4)));
    check('attractor always positive sigma', stats.badZ.length === 0, JSON.stringify(stats.badZ.slice(0, 4)));
    check('attractor sigma genuinely extreme (mean > 2.0)', meanA > 2.0, meanA.toFixed(2));
    check('void sigma negative on average', meanV < -1.0, meanV.toFixed(2));
    check('expected count matches closed form', Math.max.apply(null, stats.expectedErr) < 1e-9, String(Math.max.apply(null, stats.expectedErr)));
    check('deterministic for fixed entropy', stats.deterministic === true);
    check('generation under 250 ms', Math.max.apply(null, stats.ms) < 250, String(Math.max.apply(null, stats.ms)));

    /* ── 3. UI: generate ─────────────────────────────────────────── */
    console.log('\n[3] UI generate');
    const how = await clickEl(page, '#btnGenerate');
    if (how !== 'mouse') note('click path: ' + how);
    try {
      await page.waitForFunction(() => {
        const p = document.querySelector('[data-panel="result"]');
        return p && !p.hidden && document.querySelector('#resDist').textContent !== '--';
      }, { timeout: 15000 });
    } catch (e) {
      await dumpState(page, 'after generate timeout');
      throw e;
    }

    const r1 = await page.evaluate(() => ({
      type: document.querySelector('#resType').textContent.trim(),
      sigma: document.querySelector('#resZ').textContent.trim(),
      dist: document.querySelector('#resDist').textContent.trim(),
      unit: document.querySelector('#resUnit').textContent.trim(),
      line: document.querySelector('#resLine').textContent.trim(),
      coords: document.querySelector('#resCoords').textContent.trim(),
      stats: document.querySelector('#resStats').textContent.trim(),
      marker: !!document.querySelector('.mk-target'),
      lineDrawn: !!document.querySelector('.leaflet-overlay-pane path'),
      badge: document.querySelector('#journalBadge').textContent.trim()
    }));
    note('result: ' + r1.type + ' ' + r1.sigma + ', ' + r1.dist + r1.unit + ' — ' + r1.line);
    note('stats: ' + r1.stats);

    check('type shown', /Attractor|Void|Random|Blind spot/.test(r1.type), r1.type);
    check('sigma shown', /^\u03c3\s[+\u2212]\d/.test(r1.sigma.replace(/\s+/g, ' ')), r1.sigma);
    check('distance shown', /^\d/.test(r1.dist), r1.dist);
    check('bearing line shown', /bearing \d+/.test(r1.line), r1.line);
    check('coordinates shown', /\u00b0\s?[NS]\s+\d/.test(r1.coords), r1.coords);
    check('sample stats shown', /\d{2},\d{3}[\s\u00a0]points/.test(r1.stats), JSON.stringify(r1.stats));
    check('target marker on map', r1.marker);
    check('origin-to-point line drawn', r1.lineDrawn);
    check('journal badge set to 1', r1.badge === '1', r1.badge);

    // the map flies for 850 ms; measure where the marker lands afterwards
    await new Promise(r => setTimeout(r, 1400));
    const fit = await page.evaluate(() => {
      const m = document.querySelector('.mk-target');
      const p = document.querySelector('[data-panel="result"]');
      const h = document.querySelector('.hud');
      const mb = m.getBoundingClientRect(), pb = p.getBoundingClientRect(), hb = h.getBoundingClientRect();
      return {
        markerTop: Math.round(mb.top),
        markerBottom: Math.round(mb.bottom),
        panelTop: Math.round(pb.top),
        hudBottom: Math.round(hb.bottom),
        clearBelow: mb.bottom < pb.top,
        clearAbove: mb.top > hb.bottom
      };
    });
    note('marker ' + fit.markerTop + '..' + fit.markerBottom + ' · sheet from ' + fit.panelTop + ' · hud to ' + fit.hudBottom);
    check('target marker sits clear of the sheet', fit.clearBelow, JSON.stringify(fit));
    check('target marker sits clear of the header', fit.clearAbove, JSON.stringify(fit));

    await shot(page, 'mobile-result.png');

    /* ── 4. navigation ───────────────────────────────────────────── */
    console.log('\n[4] navigation');
    await clickEl(page, '#btnNavigate');
    await page.waitForFunction(() => !document.querySelector('#navhud').hidden, { timeout: 5000 });

    const nav = await page.evaluate(() => ({
      dist: document.querySelector('#navDist').textContent.trim(),
      bearing: document.querySelector('#navBearing').textContent.trim(),
      needle: getComputedStyle(document.querySelector('#needle')).transform,
      navmode: document.body.dataset.nav,
      bigDist: getComputedStyle(document.querySelector('.result__dist')).display
    }));
    note('navigation: ' + nav.dist + ' · ' + nav.bearing);

    check('nav distance shown', /^\d/.test(nav.dist), nav.dist);
    check('nav bearing shown', /bearing \d+\u00b0/.test(nav.bearing), nav.bearing);
    const boxes = await page.evaluate(() => {
      const b = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) }; };
      return { dist: b('#navDist'), bearing: b('#navBearing'), hud: b('#navhud') };
    });
    const gap = boxes.bearing.t - boxes.dist.b;
    note('nav readout gap ' + gap + 'px · hud h=' + boxes.hud.h);
    check('nav distance and bearing do not collide', gap >= 3, 'gap ' + gap);
    check('needle rotated', nav.needle !== 'none', nav.needle);
    check('nav mode flagged on body', nav.navmode === 'on');
    check('duplicate distance hidden while walking', nav.bigDist === 'none', nav.bigDist);
    check('body does not scroll', await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'));

    await shot(page, 'mobile-navigate.png');

    /* ── 5. finish + note ────────────────────────────────────────── */
    console.log('\n[5] arrive and note');
    await clickEl(page, '#btnNavigate');
    await page.waitForFunction(() => !document.querySelector('[data-panel="arrived"]').hidden, { timeout: 5000 });
    await page.type('#arrivedNote', 'A gate with no fence behind it.');
    await clickEl(page, '#btnSaveNote');
    await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden, { timeout: 5000 });

    /* ── 6. journal ──────────────────────────────────────────────── */
    console.log('\n[6] journal');
    await clickEl(page, '#btnJournal');
    await page.waitForFunction(() => !document.querySelector('#drawer').hidden, { timeout: 5000 });
    const j = await page.evaluate(() => ({
      rows: document.querySelectorAll('.jentry').length,
      note: (document.querySelector('.jentry__note') || {}).textContent || '',
      arrived: (document.querySelector('.jentry__arrived') || {}).textContent || '',
      intent: (document.querySelector('.jentry__intent') || {}).textContent || ''
    }));
    note('journal rows: ' + j.rows + ' · note: "' + j.note + '"');
    check('journal has the point', j.rows === 1, String(j.rows));
    check('note persisted', j.note === 'A gate with no fence behind it.', j.note);
    check('arrival recorded', j.arrived === 'arrived', j.arrived);
    check('empty intention labelled', /no intention set/.test(j.intent), j.intent);

    await shot(page, 'mobile-journal.png');
    await page.evaluate(() => document.querySelector('#drawer [data-close]').click());

    /* ── 7. persistence ──────────────────────────────────────────── */
    console.log('\n[7] persistence across reload');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('#journalBadge'), { timeout: 15000 });
    const afterReload = await page.evaluate(() => ({
      badge: document.querySelector('#journalBadge').textContent.trim(),
      stored: JSON.parse(localStorage.getItem('elsewhere.journal.v1') || '[]').length
    }));
    check('journal survives reload', afterReload.stored === 1, JSON.stringify(afterReload));
    check('badge survives reload', afterReload.badge === '1', afterReload.badge);

    /* ── 8. shared link ──────────────────────────────────────────── */
    console.log('\n[8] shared point');
    const shared = new URL(BASE);
    shared.searchParams.set('p', '55.97745,-3.20111');
    shared.searchParams.set('t', 'void');
    shared.searchParams.set('z', '-2.40');
    shared.searchParams.set('i', 'the colour of the water');
    await page.goto(shared.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden, { timeout: 15000 });
    const sh = await page.evaluate(() => ({
      type: document.querySelector('#resType').textContent.trim(),
      intent: document.querySelector('#resIntent').textContent,
      coords: document.querySelector('#resCoords').textContent,
      sigma: document.querySelector('#resZ').textContent
    }));
    note('shared: ' + sh.type + ' ' + sh.coords);
    check('shared type restored', sh.type === 'Void', sh.type);
    check('shared intention restored', /colour of the water/.test(sh.intent), sh.intent);
    check('shared coordinates restored', /55\.97745/.test(sh.coords), sh.coords);
    check('shared sigma restored', /2\.40/.test(sh.sigma), sh.sigma);

    /* ── 9. every type through the UI ────────────────────────────── */
    console.log('\n[9] all four types through the UI');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent), { timeout: 25000 });
    const chipFor = { attractor: 'Attractor', void: 'Void', random: 'Random', blind: 'Blind spot' };
    for (const t of ['void', 'random', 'blind', 'attractor']) {
      await page.evaluate(type => document.querySelector('.seg__btn[data-type="' + type + '"]').click(), t);
      await clickEl(page, '#btnGenerate');
      await page.waitForFunction(expected => {
        const p = document.querySelector('[data-panel="result"]');
        return p && !p.hidden && document.querySelector('#resType').textContent.trim() === expected;
      }, { timeout: 15000 }, chipFor[t]);
      note(t + ' -> ' + (await page.$eval('#resZ', n => n.textContent.trim())));
      check('type ' + t + ' generated', true);
    }

    /* ── 10. settings persist ────────────────────────────────────── */
    console.log('\n[10] settings');
    await page.evaluate(() => {
      const r = document.querySelector('#radius');
      r.value = '4';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      const i = document.querySelector('#intention');
      i.value = 'a door left open';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const radiusText = await page.$eval('#radiusOut', n => n.textContent.trim());
    check('radius label updates', radiusText === '8 km', radiusText);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('#radiusOut'), { timeout: 15000 });
    const persisted = await page.evaluate(() => ({
      r: document.querySelector('#radiusOut').textContent.trim(),
      i: document.querySelector('#intention').value
    }));
    check('radius persists', persisted.r === '8 km', persisted.r);
    check('intention persists', persisted.i === 'a door left open', persisted.i);

    /* ── 11. desktop render ──────────────────────────────────────── */
    console.log('\n[11] desktop render');
    const desk = hardenPage(await browser.newPage());
    await desk.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const deskErrors = [];
    desk.on('pageerror', e => deskErrors.push(e.message));
    await desk.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 8 });
    await desk.goto(BASE, { waitUntil: 'domcontentloaded' });
    await desk.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent), { timeout: 25000 });
    await clickEl(desk, '#btnGenerate');
    await desk.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden, { timeout: 15000 });
    await shot(desk, 'desktop-result.png');

    const overflow = await desk.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.panel, .hud, .result__actions, .seg').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > window.innerWidth + 1) bad.push(el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      });
      return bad;
    });
    check('desktop: nothing overflows', overflow.length === 0, JSON.stringify(overflow));
    check('desktop: no page errors', deskErrors.length === 0, deskErrors.join(' | '));

    const clipped = await desk.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.result__num, .result__intent, .res__z, .chip, .cta__label').forEach(el => {
        if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className + ' ' + el.scrollWidth + '>' + el.clientWidth);
      });
      return bad;
    });
    check('desktop: no clipped text', clipped.length === 0, JSON.stringify(clipped));

    /* ── 12. console ─────────────────────────────────────────────── */
    console.log('\n[12] console');
    const realErrors = consoleErrors.filter(e =>
      !/cloudflareinsights|favicon|ERR_INTERNET|basemaps\.cartocdn|tile\.openstreetmap|ERR_NAME_NOT_RESOLVED|ERR_CERT/.test(e));
    if (consoleErrors.length) consoleErrors.slice(0, 6).forEach(e => note('console: ' + e.slice(0, 170)));
    check('no page or console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(58));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (pass === 0) { console.log('ZERO CHECKS RAN'); process.exitCode = 1; }
  if (fail) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log('  x ' + f));
    process.exitCode = 1;
  }
})().catch(e => {
  console.error('\nHARNESS ERROR: ' + (e && e.stack || e));
  process.exitCode = 1;
});
