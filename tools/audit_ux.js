/* UX audit probe: drives the states that screenshots don't show. */
const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const out = [];
const say = (k, v) => { out.push(k + ': ' + v); console.log('  ' + k + ': ' + v); };

async function launch() {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', protocolTimeout: 60000,
    args: ['--no-sandbox', '--hide-scrollbars']
  });
  return b;
}
function harden(p) {
  const o = p.waitForFunction.bind(p);
  p.waitForFunction = (f, op, ...r) => o(f, Object.assign({ polling: 100, timeout: 25000 }, op || {}), ...r);
  return p;
}

/* ---------- contrast ---------- */
function lum(hex) {
  const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  return ((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(2);
}

(async () => {
  console.log('\n=== contrast (panel ground #0b0d12) ===');
  const ground = '#0b0d12';
  for (const [name, hex] of [['--text', '#e9e7e0'], ['--muted', '#8d8c85'], ['--dim', '#5d5d58'], ['acid', '#d8ff3e']]) {
    say(name, ratio(hex, ground) + ':1');
  }

  /* ---------- A. location denied ---------- */
  console.log('\n=== A. first run with location denied ===');
  let browser = await launch();
  let ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, []);   // explicitly nothing
  let page = harden(await browser.newPage());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  let s = await page.evaluate(() => ({
    status: document.querySelector('#status').textContent.trim(),
    noticeVisible: !document.querySelector('#notice').hidden,
    noticeText: document.querySelector('#notice').textContent.trim().slice(0, 120),
    mapZoom: (() => { try { return 'n/a'; } catch (e) { return 'err'; } })(),
    ctaEnabled: !document.querySelector('#btnGenerate').disabled,
    placesRow: document.querySelector('#placesCount').textContent.trim()
  }));
  say('status', s.status);
  say('notice shown', s.noticeVisible ? 'yes — "' + s.noticeText + '"' : 'no');
  say('places row', s.placesRow);

  // tap the middle of the visible map
  await page.mouse.click(195, 260);
  await new Promise(r => setTimeout(r, 1200));
  s = await page.evaluate(() => ({
    status: document.querySelector('#status').textContent.trim(),
    placesRow: document.querySelector('#placesCount').textContent.trim()
  }));
  say('after tapping the world map', s.status + ' | places: ' + s.placesRow);

  await page.click('#btnGenerate');
  await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden, { timeout: 20000 }).catch(() => {});
  const geo = await page.evaluate(() => {
    const c = document.querySelector('#resCoords').textContent.trim();
    const p = !document.querySelector('[data-panel="result"]').hidden;
    return { shown: p, coords: c, place: document.querySelector('#resPlace').hidden ? '' : document.querySelector('#resPlace').textContent.trim() };
  });
  say('generated from a denied-location tap', geo.shown ? geo.coords + ' | ' + (geo.place || 'no place') : 'no result');

  const deniedShot = '/tmp/denied.png';
  await page.screenshot({ path: 'C:/Users/bryan/Desktop/Projects/Elsewhere/qa/ux-denied.png' });
  await browser.close();

  /* ---------- B. granted: state machine ---------- */
  console.log('\n=== B. state machine + sizing (location granted) ===');
  browser = await launch();
  ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);
  page = harden(await browser.newPage());
  await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 6 });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));

  const sizes = await page.evaluate(() => {
    const small = [];
    document.querySelectorAll('button, input, [role="radio"], a').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.width < 44 || r.height < 44) {
        small.push({
          el: (el.id || el.className || el.tagName).toString().slice(0, 28),
          w: Math.round(r.width), h: Math.round(r.height)
        });
      }
    });
    const tiny = [];
    document.querySelectorAll('.panel *').forEach(el => {
      if (!el.textContent || el.children.length) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs && fs < 12) tiny.push({ cls: el.className || el.tagName, fs });
    });
    return { small, tiny };
  });
  say('interactive targets under 44px', sizes.small.length + ' → ' + sizes.small.slice(0, 6).map(x => x.el + ' ' + x.w + 'x' + x.h).join(', '));
  say('text under 12px', sizes.tiny.length + ' → ' + [...new Set(sizes.tiny.map(x => x.fs))].join(', ') + 'px');

  // enter key in intention
  await page.click('#intention');
  await page.type('#intention', 'a quiet place');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 800));
  say('Enter in the intention field generates?', await page.evaluate(() => !document.querySelector('[data-panel="result"]').hidden) ? 'yes' : 'NO — nothing happens');

  // generate, then look for a route back to the settings
  await page.click('#btnGenerate');
  await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden);
  await new Promise(r => setTimeout(r, 1200));
  const back = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-panel="result"] button')].map(b => (b.id || b.className).toString());
    return { buttons: ids, controlsVisible: !document.querySelector('[data-panel="controls"]').hidden };
  });
  say('result panel buttons', back.buttons.join(', '));
  say('settings reachable from result?', back.controlsVisible ? 'yes' : 'NO');

  // press "Again" — does it change the radius or just regenerate?
  const before = await page.$eval('#radiusOut', n => n.textContent).catch(() => 'n/a');
  say('radius visible on the result screen?', before === 'n/a' ? 'no' : 'yes');

  // journal entry path
  await page.click('#btnJournal');
  await page.waitForFunction(() => !document.querySelector('#drawer').hidden);
  const j = await page.evaluate(() => ({
    rows: document.querySelectorAll('.jentry').length,
    perRowButtons: document.querySelectorAll('.jentry button').length
  }));
  say('journal rows', j.rows + ' · delete-per-row buttons: ' + j.perRowButtons);
  await page.evaluate(() => document.querySelector('#places') /* noop */);
  await page.evaluate(() => document.querySelector('#drawer [data-close]').click());

  // aria-live on the nav hud
  const aria = await page.evaluate(() => {
    const n = document.querySelector('#navhud');
    return { live: n.getAttribute('aria-live'), role: n.getAttribute('role'), distHasLive: document.querySelector('#navDist').closest('[aria-live]') ? 'inside a live region' : 'no' };
  });
  say('nav hud aria-live', aria.live + ' (region updates every position fix)');

  // radiogroup keyboard behaviour
  const kb = await page.evaluate(() => {
    const first = document.querySelector('.seg__btn');
    first.focus();
    return { role: first.getAttribute('role'), tabindex: first.getAttribute('tabindex') };
  });
  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 300));
  const kb2 = await page.evaluate(() => ({
    focused: document.activeElement.className,
    checked: [...document.querySelectorAll('.seg__btn')].filter(b => b.getAttribute('aria-checked') === 'true').length
  }));
  say('radiogroup arrow-key nav', kb2.focused.includes('seg__btn') && kb2.checked === 1 ? 'works' : 'no — arrow keys do not move between modes');

  // place dots interactive?
  const dots = await page.evaluate(() => {
    const c = document.querySelector('.leaflet-overlay-pane canvas');
    return c ? 'canvas renderer (dots are not individually clickable)' : 'no canvas';
  });
  say('place dots', dots);

  await browser.close();

  /* ---------- C. blind spot with an empty journal ---------- */
  console.log('\n=== C. blind spot on a fresh profile ===');
  browser = await launch();
  ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);
  page = harden(await browser.newPage());
  await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 6 });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));
  await page.evaluate(() => document.querySelector('.seg__btn[data-type="blind"]').click());
  await page.click('#btnGenerate');
  await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden);
  await new Promise(r => setTimeout(r, 900));
  const blind = await page.evaluate(() => ({
    chip: document.querySelector('#resType').textContent.trim(),
    stats: document.querySelector('#resStats').textContent.trim(),
    sigma: document.querySelector('#resZ').textContent.trim(),
    journalEmpty: JSON.parse(localStorage.getItem('elsewhere.journal.v1') || '[]').length === 0
  }));
  say('blind spot, empty journal', blind.chip + ' ' + blind.sigma + ' — any explanation? ' + (/empty|no history|first/i.test(blind.stats) ? 'yes' : 'NO'));

  await browser.close();

  console.log('\n=== summary ===');
  console.log(out.join('\n'));
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
