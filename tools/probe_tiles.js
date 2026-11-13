const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', protocolTimeout: 40000, args: ['--no-sandbox', '--hide-scrollbars']
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, []);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const failed = [];
  page.on('requestfailed', r => { if (/tile/.test(r.url())) failed.push(r.url()); });
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 6000));

  const info = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.leaflet-tile')];
    return {
      tileCount: tiles.length,
      loaded: tiles.filter(t => t.complete && t.naturalWidth > 0).length,
      sample: tiles.slice(0, 3).map(t => t.src.replace('https://', '')),
      zoom: (() => { const c = document.querySelector('.leaflet-container'); return c ? c.style.zIndex : null; })(),
      paneOpacity: getComputedStyle(document.querySelector('.leaflet-tile-pane')).opacity,
      filter: getComputedStyle(document.querySelector('.leaflet-tile-pane')).filter
    };
  });
  console.log('TILES', JSON.stringify(info));
  console.log('FAILED', failed.slice(0, 4).join(' | ') || 'none');

  // sample the rendered pixels in the map area
  const shot = await page.screenshot({ encoding: 'base64' });
  require('fs').writeFileSync('C:/Users/bryan/Desktop/Projects/Elsewhere/qa/zoom2.png', Buffer.from(shot, 'base64'));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
