import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: st, locale: 'en-US' });
const page = await context.newPage();

const samples: any[] = [];
page.on('request', async (req) => {
  const u = req.url();
  if (!/x\.com\/i\/api\/|api\.x\.com\//.test(u)) return;
  const h = await req.allHeaders().catch(() => ({} as Record<string, string>));
  const tid = h['x-client-transaction-id'];
  if (!tid) return;
  samples.push({
    method: req.method(),
    path: new URL(u).pathname,
    tid,
    at: Date.now(),
  });
});

await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(7000);

// The two page-side inputs twikit's algorithm needs.
const pageData = await page.evaluate(() => {
  const key = document
    .querySelector("[name='twitter-site-verification']")
    ?.getAttribute('content');
  const frames = [...document.querySelectorAll("[id^='loading-x-anim']")].map((el) => {
    const svg = el.children[0];
    const path = svg?.children?.[1];
    return path?.getAttribute('d') ?? null;
  });
  return { key, frames };
});

await browser.close();

writeFileSync(
  'scripts/.tid-samples.json',
  JSON.stringify({ samples, pageData }, null, 2),
  'utf-8'
);

console.log(`captured ${samples.length} tid samples`);
console.log('verification key present:', !!pageData.key, pageData.key ? `(${pageData.key.length} chars)` : '');
console.log('animation frames found:', pageData.frames.filter(Boolean).length);
console.log('sample paths:', [...new Set(samples.map((s) => `${s.method} ${s.path}`))].slice(0, 5));
