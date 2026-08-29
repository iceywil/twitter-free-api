import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const cap = JSON.parse(readFileSync('scripts/.capture.json', 'utf-8'));
const path = cap.captured[0].headers[':path'];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'en-US' });
await context.addCookies([
  { name: 'auth_token', value: process.env.TWITTER_AUTH_TOKEN!, domain: '.x.com', path: '/', httpOnly: true, secure: true },
  { name: 'ct0', value: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)!, domain: '.x.com', path: '/', secure: true },
]);

const page = await context.newPage();
await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });

// Run the request inside the page: Chrome's TLS stack, Chrome's cookies,
// and NO x-client-transaction-id header of our own.
const result = await page.evaluate(async ({ p, token }) => {
  const ct0 = document.cookie.split('; ').find((c) => c.startsWith('ct0='))?.slice(4) ?? '';
  const res = await fetch(p, {
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-csrf-token': ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
    },
    credentials: 'include',
  });
  const text = await res.text();
  let tweets = 0;
  try {
    const j = JSON.parse(text);
    const walk = (o: any): void => {
      if (o && typeof o === 'object') {
        if (o.__typename === 'Tweet') tweets++;
        for (const v of Object.values(o)) walk(v);
      }
    };
    walk(j);
  } catch { /* non-json */ }
  return { status: res.status, len: text.length, tweets };
}, { p: path, token: (await import('../src/constants.js')).TOKEN });

console.log('In-page fetch (no transaction-id header of our own):');
console.log(`  status=${result.status} bytes=${result.len} tweets=${result.tweets}`);
console.log(result.status === 200 && result.tweets > 0 ? '  => SEARCH WORKS through the browser context' : '  => still refused');

await browser.close();
