'use strict';

const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
    defaultViewport: { width: 512, height: 512, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(`file:///${path.join(ROOT, 'assets', 'icon.svg').replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(ROOT, 'assets', 'icon.png'), omitBackground: true });
  await browser.close();
  console.log('wrote assets/icon.png');
})().catch((err) => { console.error(err); process.exit(1); });
