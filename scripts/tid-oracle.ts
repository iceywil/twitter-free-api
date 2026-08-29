import { readFileSync, writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: st, locale: 'en-US' });
const page = await context.newPage();

let rawHtml: string | null = null;
const samples: any[] = [];

// Grab the document body before hydration removes the animation nodes.
page.on('response', async (res) => {
  if (rawHtml) return;
  const ct = (await res.allHeaders().catch(() => ({})))['content-type'] ?? '';
  if (res.request().resourceType() !== 'document' || !ct.includes('text/html')) return;
  rawHtml = await res.text().catch(() => null);
});

page.on('request', async (req) => {
  const u = req.url();
  if (!/x\.com\/i\/api\/|api\.x\.com\//.test(u)) return;
  const h = await req.allHeaders().catch(() => ({} as Record<string, string>));
  const tid = h['x-client-transaction-id'];
  if (tid) samples.push({ method: req.method(), path: new URL(u).pathname, tid, at: Date.now() });
});

await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(7000);
await browser.close();

if (!rawHtml) {
  console.log('no document HTML captured');
  process.exit(1);
}

const $ = cheerio.load(rawHtml);
const key = $("[name='twitter-site-verification']").attr('content') ?? null;
const frames: string[] = [];
$("[id^='loading-x-anim']").each((_, el) => {
  const d = $(el).children().first().children().eq(1).attr('d');
  if (d) frames.push(d);
});

console.log('raw HTML bytes:', rawHtml.length);
console.log('key from same load:', key ? `${key.slice(0, 14)}... (${key.length} chars)` : 'MISSING');
console.log('frames from same load:', frames.length);
console.log('tid samples:', samples.length);

writeFileSync(
  'scripts/.oracle.json',
  JSON.stringify({ key, frames, samples }, null, 2),
  'utf-8'
);
console.log('saved -> scripts/.oracle.json');
