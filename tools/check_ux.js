/* UX gate: asserts the things the critique found. Fails loudly.
   node tools/check_ux.js [base-url] */
const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
const fails = [];
const check = (n, c, d) => { if (c) pass++; else { fail++; fails.push(n + (d ? ' :: ' + d : '')); } };
const note = m => console.log('  ' + m);

const launch = () => puppeteer.launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 60000,
  args: ['--no-sandbox', '--hide-scrollbars']
});
function harden(p) {
  const o = p.waitForFunction.bind(p);
  p.waitForFunction = (f, op, ...r) => o(f, Object.assign({ polling: 100, timeout: 25000 }, op || {}), ...r);
  return p;
}

/* ---------- contrast helper ---------- */
function lum(hex) {
  const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

(async () => {
  /* ── A. location denied: the recovery path ─────────────────────── */
  console.log('\n[A] location denied');
  let browser = await launch();
  let ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, []);
  let page = harden(await browser.newPage());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

  let located = false;
  try {
    await page.waitForFunction(() => !document.querySelector('#locateBlock').hidden, { timeout: 15000 });
    located = true;
  } catch (e) {}
  const loc = await page.evaluate(() => ({
    blockShown: !document.querySelector('#locateBlock').hidden,
    msg: document.querySelector('#locateMsg').textContent.trim(),
    hasSearch: !!document.querySelector('#locateInput'),
    placesHidden: document.querySelector('#placesRow').hidden,
    status: document.querySelector('#status').textContent.trim()
  }));
  note('locate block shown: ' + loc.blockShown + ' · search field: ' + loc.hasSearch);
  note('status: ' + loc.status);
  check('denied location offers a way in', located && loc.blockShown && loc.hasSearch, JSON.stringify(loc));
  check('places row is not left spinning', loc.placesHidden === true);

  // tapping a world-scale map must not silently produce an ocean point
  const target = await page.evaluate(() => {
    const panelTop = document.querySelector('.panel:not([hidden])').getBoundingClientRect().top;
    const n = document.querySelector('#notice');
    const noticeBottom = n.hidden ? 60 : n.getBoundingClientRect().bottom;
    return { x: 56, y: Math.round(Math.max(noticeBottom + 26, Math.min(panelTop - 60, 260))), panelTop: Math.round(panelTop) };
  });
  note('tapping the map at ' + target.x + ',' + target.y + ' (panel starts at ' + target.panelTop + ')');
  await page.mouse.click(target.x, target.y);
  await new Promise(r => setTimeout(r, 1500));
  const guard = await page.evaluate(() => ({
    msg: document.querySelector('#locateMsg').textContent.trim(),
    status: document.querySelector('#status').textContent.trim(),
    resultShown: !document.querySelector('[data-panel="result"]').hidden
  }));
  note('after a world-scale tap: "' + guard.msg + '"');
  check('a world-scale tap is refused with guidance', /zoom into the map/i.test(guard.msg), JSON.stringify(guard));
  check('no ocean point was generated', guard.resultShown === false);

  // search by name
  await page.type('#locateInput', 'Edinburgh');
  await page.keyboard.press('Enter');
  let searched = false;
  try {
    await page.waitForFunction(() => /Ready/.test(document.querySelector('#status').textContent), { timeout: 20000 });
    searched = true;
  } catch (e) {}
  const after = await page.evaluate(() => ({
    status: document.querySelector('#status').textContent.trim(),
    blockHidden: document.querySelector('#locateBlock').hidden,
    placesShown: !document.querySelector('#placesRow').hidden
  }));
  note('after search: ' + after.status);
  check('searching a place sets the origin', searched, JSON.stringify(after));
  check('locate block collapses once located', after.blockHidden === true);
  check('places row appears once located', after.placesShown === true);

  await page.screenshot({ path: 'C:/Users/bryan/Desktop/Projects/Elsewhere/qa/ux-locate.png' });
  await browser.close();

  /* ── B. granted: navigation between states, keyboard, sizes ────── */
  console.log('\n[B] state machine');
  browser = await launch();
  ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);
  page = harden(await browser.newPage());
  await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 6 });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));
  await page.waitForFunction(() => /\d[\d,]* known place/.test(document.querySelector('#placesCount').textContent));

  const contrast = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = v => cs.getPropertyValue(v).trim();
    return { dim: get('--dim'), muted: get('--muted'), text: get('--text') };
  });
  const rDim = ratio(contrast.dim, '#0b0d12');
  const rMuted = ratio(contrast.muted, '#0b0d12');
  note('contrast: dim ' + rDim.toFixed(2) + ':1 · muted ' + rMuted.toFixed(2) + ':1');
  check('secondary text meets AA (4.5:1)', rDim >= 4.5, rDim.toFixed(2));
  check('muted text is comfortably above AA', rMuted >= 6, rMuted.toFixed(2));

  const sizes = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.hud__actions button, #btnGenerate, #intention, .locate__form input, .locate__go').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.height < 40) bad.push((el.id || el.className) + ' h=' + Math.round(r.height));
    });
    return bad;
  });
  note('primary targets under 40px: ' + (sizes.length ? sizes.join(', ') : 'none'));
  check('primary controls are at least 40px tall', sizes.length === 0, sizes.join(', '));

  // Enter in the intention field
  await page.click('#intention');
  await page.type('#intention', 'a quiet place');
  await page.keyboard.press('Enter');
  let entered = false;
  try {
    await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden, { timeout: 15000 });
    entered = true;
  } catch (e) {}
  check('Enter in the intention field generates', entered);

  // back to settings
  const backVisible = await page.evaluate(() => {
    const b = document.querySelector('#btnBack');
    return !!b && !b.hidden && b.getBoundingClientRect().width > 20;
  });
  check('result offers a way back to settings', backVisible);
  await page.click('#btnBack');
  await page.waitForFunction(() => !document.querySelector('[data-panel="controls"]').hidden, { timeout: 5000 });
  const settings = await page.evaluate(() => ({
    controls: !document.querySelector('[data-panel="controls"]').hidden,
    lastPoint: !document.querySelector('#btnLastPoint').hidden,
    radius: document.querySelector('#radiusOut').textContent.trim(),
    intention: document.querySelector('#intention').value
  }));
  note('back to settings: radius ' + settings.radius + ', intention "' + settings.intention + '"');
  check('settings are reachable again', settings.controls === true);
  check('the previous point is one tap away', settings.lastPoint === true);
  check('intention survived the round trip', settings.intention === 'a quiet place', settings.intention);

  await page.click('#btnLastPoint');
  await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden, { timeout: 5000 });
  check('last point returns to the result', true);

  // arrow keys in the radiogroup
  await page.click('#btnBack');
  await page.waitForFunction(() => !document.querySelector('[data-panel="controls"]').hidden);
  await page.evaluate(() => { document.querySelector('.seg__btn.is-on').focus(); });
  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 250));
  const kb = await page.evaluate(() => ({
    focused: document.activeElement.getAttribute('data-type'),
    checked: document.querySelector('.seg__btn[aria-checked="true"]').getAttribute('data-type'),
    tabbable: [...document.querySelectorAll('.seg__btn')].filter(b => b.tabIndex === 0).length
  }));
  note('arrow key moved to ' + kb.focused + ', checked ' + kb.checked);
  check('arrow keys move between modes', kb.focused === kb.checked && kb.focused !== null, JSON.stringify(kb));
  check('exactly one mode is tabbable', kb.tabbable === 1, String(kb.tabbable));

  // journal delete
  await page.click('#btnJournal');
  await page.waitForFunction(() => !document.querySelector('#drawer').hidden);
  const before = await page.evaluate(() => document.querySelectorAll('.jrow').length);
  await page.evaluate(() => document.querySelector('.jdel').click());
  await new Promise(r => setTimeout(r, 300));
  const after2 = await page.evaluate(() => ({
    rows: document.querySelectorAll('.jrow').length,
    stored: JSON.parse(localStorage.getItem('elsewhere.journal.v1') || '[]').length
  }));
  note('journal rows ' + before + ' -> ' + after2.rows);
  check('a single journal entry can be deleted', after2.rows === before - 1 && after2.stored === before - 1, JSON.stringify(after2));
  await page.evaluate(() => document.querySelector('#drawer [data-close]').click());

  // nav hud must not be a live region
  const aria = await page.evaluate(() => [
    document.querySelector('#navhud').getAttribute('aria-live'),
    !!document.querySelector('#live[aria-live]')
  ]);
  check('the compass HUD is not a live region', aria[0] === null, String(aria[0]));
  check('a dedicated live region exists for announcements', aria[1] === true);

  await browser.close();

  /* ── C. blind spot with an empty journal ───────────────────────── */
  console.log('\n[C] blind spot, fresh profile');
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
  await new Promise(r => setTimeout(r, 600));
  const caveat = await page.evaluate(() => ({
    shown: !document.querySelector('#resCaveat').hidden,
    text: document.querySelector('#resCaveat').textContent.trim(),
    empty: JSON.parse(localStorage.getItem('elsewhere.journal.v1') || '[]').length <= 1
  }));
  note('caveat: ' + (caveat.shown ? '"' + caveat.text + '"' : 'none'));
  check('an empty journal is disclosed on a blind spot', caveat.shown && /journal is empty/i.test(caveat.text), JSON.stringify(caveat));

  await browser.close();

  console.log('\n' + '-'.repeat(58));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (pass === 0) { console.log('ZERO CHECKS RAN'); process.exitCode = 1; }
  if (fail) { fails.forEach(f => console.log('  x ' + f)); process.exitCode = 1; }
})().catch(e => { console.error('ERR ' + e.message); process.exitCode = 1; });
