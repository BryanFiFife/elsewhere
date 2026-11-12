const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';
const W = parseInt(process.argv[3] || '360', 10);
const H = parseInt(process.argv[4] || '640', 10);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', protocolTimeout: 60000, args: ['--no-sandbox', '--hide-scrollbars']
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);
  const page = await browser.newPage();
  const o = page.waitForFunction.bind(page);
  page.waitForFunction = (f, op, ...r) => o(f, Object.assign({ polling: 100, timeout: 30000 }, op || {}), ...r);
  await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 6 });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));

  const before = await page.evaluate(() => {
    const p = document.querySelector('[data-panel="controls"]').getBoundingClientRect();
    return { controlsTop: Math.round(p.top), controlsH: Math.round(p.height), vh: innerHeight, vw: innerWidth };
  });
  console.log('CONTROLS', JSON.stringify(before));

  await page.click('#btnGenerate');
  await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden);
  await new Promise(r => setTimeout(r, 1500));

  const after = await page.evaluate(() => {
    const pn = document.querySelector('[data-panel="result"]');
    const p = pn.getBoundingClientRect();
    const rows = {};
    ['.result__top', '.result__dist', '.result__line', '.result__intent', '.result__coords', '.result__actions', '.stats'].forEach(s => {
      const e = pn.querySelector(s);
      if (e) { const r = e.getBoundingClientRect(); rows[s] = [Math.round(r.top), Math.round(r.height)]; }
    });
    return {
      panel: [Math.round(p.top), Math.round(p.bottom), Math.round(p.height)],
      vh: innerHeight, sheetVar: getComputedStyle(document.documentElement).getPropertyValue('--sheet-h'),
      rows
    };
  });
  console.log('RESULT  ', JSON.stringify(after, null, 1));

  await page.screenshot({ path: `C:/Users/bryan/Desktop/Projects/Elsewhere/qa/w-${W}x${H}.png` });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
