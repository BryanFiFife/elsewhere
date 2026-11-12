const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', protocolTimeout: 60000, args: ['--no-sandbox', '--hide-scrollbars']
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);
  const page = await browser.newPage();
  const o = page.waitForFunction.bind(page);
  page.waitForFunction = (f, op, ...r) => o(f, Object.assign({ polling: 100, timeout: 25000 }, op || {}), ...r);
  await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 6 });

  const sizes = [[320, 568], [360, 640], [414, 896], [768, 1024]];
  for (const [w, h] of sizes) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));

    const before = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.panel, .panel *, .hud, .hud *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.left < -1 || r.right > innerWidth + 1) bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      });
      const cta = document.querySelector('#btnGenerate').getBoundingClientRect();
      return { bad, ctaFits: cta.top > 0 && cta.bottom <= innerHeight, ctaBottom: Math.round(cta.bottom), vh: innerHeight };
    });

    await page.click('#btnGenerate');
    await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden);
    await new Promise(r => setTimeout(r, 1800));

    const after = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.panel, .panel *, .hud, .hud *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.left < -1 || r.right > innerWidth + 1) bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      });
      const p = document.querySelector('[data-panel="result"]').getBoundingClientRect();
      const m = document.querySelector('.mk-target');
      const mb = m ? m.getBoundingClientRect() : null;
      return {
        bad,
        panelFits: p.top >= 0 && p.bottom <= innerHeight + 1,
        panelRect: [Math.round(p.top), Math.round(p.bottom), Math.round(p.height)],
        vh: innerHeight,
        markerRect: mb ? [Math.round(mb.top), Math.round(mb.bottom)] : null,
        markerClear: mb ? mb.bottom < p.top : null
      };
    });
    console.log('          panel=' + JSON.stringify(after.panelRect) + ' vh=' + after.vh +
                ' marker=' + JSON.stringify(after.markerRect));

    console.log(`${w}x${h}  ctaFits=${before.ctaFits} panelFits=${after.panelFits} markerClear=${after.markerClear} overflow=${before.bad.length + after.bad.length}` +
      (before.bad.length + after.bad.length ? ' :: ' + before.bad.concat(after.bad).slice(0, 4).join(' | ') : ''));
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
