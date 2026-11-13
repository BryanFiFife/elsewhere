const puppeteer = require('C:/Users/bryan/AppData/Roaming/npm/node_modules/lighthouse/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://elsewhere-point.pages.dev/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, protocolTimeout: 60000,
    args: ['--no-sandbox', '--window-position=-2400,-2400', '--window-size=520,980', '--hide-scrollbars']
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(BASE).origin, []);
  const page = await browser.newPage();
  const o = page.waitForFunction.bind(page);
  page.waitForFunction = (f, op, ...r) => o(f, Object.assign({ polling: 100, timeout: 25000 }, op || {}), ...r);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 6500));
  await page.screenshot({ path: 'C:/Users/bryan/Desktop/Projects/Elsewhere/qa/shot-locate.png' });
  console.log('denied state captured');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
