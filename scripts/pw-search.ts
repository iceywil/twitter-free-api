import 'dotenv/config';
import { chromium } from 'playwright';
import { Client } from '../src/index.js';
import { findDict } from '../src/utils.js';
import { tweetFromData } from '../src/models/tweet.js';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'en-US' });
await context.addCookies([
  { name: 'auth_token', value: process.env.TWITTER_AUTH_TOKEN!, domain: '.x.com', path: '/', httpOnly: true, secure: true },
  { name: 'ct0', value: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)!, domain: '.x.com', path: '/', secure: true },
]);

const page = await context.newPage();
const payloads: any[] = [];

page.on('response', async (res) => {
  if (!/SearchTimeline/.test(res.url())) return;
  if (res.status() !== 200) return;
  try {
    payloads.push(await res.json());
  } catch { /* ignore */ }
});

const query = 'typescript';
await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForTimeout(9000);
await browser.close();

console.log(`captured ${payloads.length} SearchTimeline payload(s)`);
if (payloads.length === 0) process.exit(1);

// Parse with the port's existing model layer — no browser-specific code.
const client = new Client({ silent: true });
const entries = findDict(payloads[0], 'entries', true)[0] ?? [];
const tweets = entries
  .filter((e: any) => String(e.entryId).startsWith('tweet'))
  .map((e: any) => tweetFromData(client, e))
  .filter(Boolean);

console.log(`parsed ${tweets.length} tweets with the existing models:\n`);
for (const t of tweets.slice(0, 5)) {
  console.log(`  @${t!.user?.screenName}: ${t!.text.replace(/\s+/g, ' ').slice(0, 62)}`);
}
const cursor = entries.find((e: any) => String(e.entryId).startsWith('cursor-bottom'));
console.log(`\n  next cursor present: ${cursor ? 'yes' : 'no'}`);
