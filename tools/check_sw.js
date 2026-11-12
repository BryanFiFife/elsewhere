const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';

let pass = 0, fail = 0;
const fails = [];
const check = (n, c, d) => { if (c) pass++; else { fail++; fails.push(n + (d ? ' :: ' + d : '')); } };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', protocolTimeout: 60000, args: ['--no-sandbox']
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);

  const page = await browser.newPage();
  const orig = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, o, ...r) => orig(fn, Object.assign({ polling: 100, timeout: 25000 }, o || {}), ...r);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 8 });

  console.log('\n[sw] first load');
  await page.goto(BASE, { waitUntil: 'load', timeout: 40000 });
  const reg = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const r = await navigator.serviceWorker.ready;
    // ready() can resolve while the worker is still activating
    for (let i = 0; i < 100 && (!r.active || r.active.state !== 'activated'); i++) {
      await new Promise(res => setTimeout(res, 50));
    }
    return {
      supported: true,
      scope: r.scope,
      script: (r.active || {}).scriptURL,
      state: (r.active || {}).state
    };
  });
  console.log('  ' + JSON.stringify(reg));
  check('service worker supported', reg.supported);
  check('service worker active', reg.state === 'activated', reg.state);
  check('scope is the site root', /\/$/.test(reg.scope || ''), reg.scope);

  const cacheInfo = await page.evaluate(async () => {
    const keys = await caches.keys();
    const out = {};
    for (const k of keys) {
      const c = await caches.open(k);
      const reqs = await c.keys();
      out[k] = reqs.map(r => new URL(r.url).pathname).sort();
    }
    return out;
  });
  const cacheNames = Object.keys(cacheInfo);
  const core = cacheInfo[cacheNames[0]] || [];
  console.log('  cache ' + cacheNames.join(',') + ' -> ' + core.length + ' entries');
  check('one cache created', cacheNames.length === 1, cacheNames.join(','));
  check('shell precached', core.length >= 12, String(core.length));
  check('app js cached', core.includes('/assets/js/app.js'), core.join(' '));
  check('leaflet cached', core.includes('/assets/vendor/leaflet/leaflet.js'));

  console.log('\n[sw] second load');
  await page.reload({ waitUntil: 'load', timeout: 40000 });
  await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));
  const second = await page.evaluate(() => ({
    controlled: !!navigator.serviceWorker.controller,
    tile: (() => { const t = document.querySelector('.leaflet-tile'); return t ? t.naturalWidth : 0; })(),
    modules: !!(window.EW && EW.generator),
    tilesInCache: 0
  }));
  check('page is controlled by the worker', second.controlled);
  check('map tiles still render under the worker', second.tile > 0, String(second.tile));
  check('modules still load under the worker', second.modules);

  const tileCached = await page.evaluate(async () => {
    const keys = await caches.keys();
    let n = 0;
    for (const k of keys) {
      const c = await caches.open(k);
      for (const r of await c.keys()) if (/openstreetmap|nominatim/.test(r.url)) n++;
    }
    return n;
  });
  check('worker never caches map tiles or place lookups', tileCached === 0, String(tileCached));

  console.log('\n[sw] generate under the worker');
  await page.click('#btnGenerate');
  await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden);
  const v = await page.$eval('#resZ', n => n.textContent);
  console.log('  generated ' + v);
  check('generate works under the worker', /\u03c3/.test(v), v);

  const real = errs.filter(e => !/cloudflareinsights|favicon/.test(e));
  check('no errors', real.length === 0, real.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n' + '-'.repeat(50));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (pass === 0) process.exitCode = 1;
  if (fail) { fails.forEach(f => console.log('  x ' + f)); process.exitCode = 1; }
})().catch(e => { console.error('ERR ' + e.message); process.exitCode = 1; });
