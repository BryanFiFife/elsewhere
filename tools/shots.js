/* Capture presentation shots from the live site in a headful browser. */
const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const path = require('path');
const OUT = path.join(__dirname, '..', 'qa');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, protocolTimeout: 60000,
    args: ['--no-sandbox', '--window-position=-2400,-2400', '--window-size=1500,1000', '--hide-scrollbars']
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, ['geolocation']);

  const page = await browser.newPage();
  const orig = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, o, ...r) => orig(fn, Object.assign({ polling: 100, timeout: 30000 }, o || {}), ...r);
  await page.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 6 });

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));
  await wait(4200);
  await page.screenshot({ path: path.join(OUT, 'shot-mobile-controls.png') });

  await page.type('#intention', 'a door that should not be there');
  await page.click('#btnGenerate');
  await page.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden);
  await wait(2600);
  await page.screenshot({ path: path.join(OUT, 'shot-mobile-result.png') });

  await page.click('#btnNavigate');
  await page.waitForFunction(() => !document.querySelector('#navhud').hidden);
  await wait(1400);
  await page.screenshot({ path: path.join(OUT, 'shot-mobile-nav.png') });
  await page.click('#btnNavigate');
  await wait(600);

  await page.click('#btnInfo');
  await page.waitForFunction(() => !document.querySelector('#about').hidden);
  await wait(700);
  await page.screenshot({ path: path.join(OUT, 'shot-mobile-about.png') });
  await page.evaluate(() => document.querySelector('#about [data-close]').click());

  const desk = await browser.newPage();
  const o2 = desk.waitForFunction.bind(desk);
  desk.waitForFunction = (fn, o, ...r) => o2(fn, Object.assign({ polling: 100, timeout: 30000 }, o || {}), ...r);
  await desk.setGeolocation({ latitude: 55.9533, longitude: -3.1883, accuracy: 6 });
  await desk.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await desk.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await desk.waitForFunction(() => /Ready/i.test(document.querySelector('#status').textContent));
  await desk.type('#intention', 'somewhere with a view');
  await desk.click('#btnGenerate');
  await desk.waitForFunction(() => !document.querySelector('[data-panel="result"]').hidden);
  await wait(2800);
  await desk.screenshot({ path: path.join(OUT, 'shot-desktop.png') });

  console.log('done');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
