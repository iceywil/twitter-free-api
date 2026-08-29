/**
 * Proof: one browser page load yields an animation key; after that every
 * transaction id is generated natively in Node for any method/path.
 */
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { ClientTransaction } from '../src/transaction/transaction.js';
import { HttpSession } from '../src/internal/http.js';
import { TOKEN, FEATURES } from '../src/constants.js';
import { flattenParams } from '../src/utils.js';

const KEYWORD = 'obfiowerehiring';
const EPOCH = 1682924400;
const ct = new ClientTransaction();
const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));

const parseFrame = (d: string): number[][] =>
  d.slice(9).split('C').map((i) => i.replace(/[^\d]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number));

// ---- step 1: one page load, harvest key + frames + a single sample tid ----
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: st, locale: 'en-US' });
const page = await context.newPage();
let rawHtml: string | null = null;
let sample: { method: string; path: string; tid: string } | null = null;
page.on('response', async (r) => {
  if (!rawHtml && r.request().resourceType() === 'document') rawHtml = await r.text().catch(() => null);
});
page.on('request', async (r) => {
  if (sample) return;
  if (!/x\.com\/i\/api\/|api\.x\.com\//.test(r.url())) return;
  const h = await r.allHeaders().catch(() => ({} as Record<string, string>));
  if (h['x-client-transaction-id']) sample = { method: r.method(), path: new URL(r.url()).pathname, tid: h['x-client-transaction-id'] };
});
await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(6000);
const cookies = Object.fromEntries((await context.cookies()).filter(c => c.domain.includes('x.com')).map(c => [c.name, c.value]));
await browser.close();

const $ = cheerio.load(rawHtml!);
const key = $("[name='twitter-site-verification']").attr('content')!;
const frames: string[] = [];
$("[id^='loading-x-anim']").each((_, el) => {
  const d = $(el).children().first().children().eq(1).attr('d');
  if (d) frames.push(d);
});
const keyBytes = Array.from(Buffer.from(key, 'base64'));
const s = sample as unknown as { method: string; path: string; tid: string };

// ---- step 2: solve frameTime once, using that tid as the oracle ----
const raw = Buffer.from(s.tid + '='.repeat((4 - (s.tid.length % 4)) % 4), 'base64');
const rnd = raw[0];
const body = Buffer.from(raw.subarray(1).map((b) => b ^ rnd));
const t0 = body.readUInt32LE(48);
const target = body.subarray(52, 68).toString('hex');
const rowIndex = keyBytes[5] % 16;
const row = parseFrame(frames[keyBytes[5] % 4])[rowIndex];

let animationKey: string | null = null;
for (let ft = 0; ft < 4096; ft++) {
  const ak = ct.animate(row, ft / 4096);
  const h = createHash('sha256').update(`${s.method}!${s.path}!${t0}${KEYWORD}${ak}`).digest('hex').slice(0, 32);
  if (h === target) { animationKey = ak; console.log(`solved: rowIndex=${rowIndex} frameTime=${ft}`); break; }
}
if (!animationKey) { console.log('could not solve the animation key'); process.exit(1); }

// ---- step 3: generate tids natively, no browser ----
const mint = (method: string, path: string): string => {
  const timeNow = Math.floor((Date.now() - EPOCH * 1000) / 1000);
  const timeBytes = [0, 1, 2, 3].map((i) => (timeNow >> (i * 8)) & 0xff);
  const hash = Array.from(createHash('sha256').update(`${method}!${path}!${timeNow}${KEYWORD}${animationKey}`).digest());
  const r = randomBytes(1)[0];
  const arr = [...keyBytes, ...timeBytes, ...hash.slice(0, 16), 3];
  return Buffer.from([r, ...arr.map((b) => b ^ r)]).toString('base64').replace(/=+$/, '');
};

const session = new HttpSession();
session.setCookies(cookies);
const base = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  'x-csrf-token': cookies.ct0, 'x-twitter-active-user': 'yes',
  'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-client-language': 'en',
  referer: 'https://x.com/', ...extra,
});

console.log('\nNative Node requests using self-minted transaction ids:');

const u1 = 'https://api.x.com/1.1/account/settings.json';
const r1 = await session.request('GET', u1, { headers: base({ 'x-client-transaction-id': mint('GET', new URL(u1).pathname) }) });
console.log(`  settings.json      ${r1.status} len=${r1.text.length}${r1.status === 200 ? '  <-- WORKS' : ''}`);

const searchPath = '/i/api/graphql/hyPfJYJ_XAtDYoslQc-Rgg/SearchTimeline';
const params = flattenParams({
  variables: { rawQuery: 'typescript', count: 20, querySource: 'typed_query', product: 'Latest' },
  features: FEATURES,
});
const r2 = await session.request('GET', `https://x.com${searchPath}`, {
  params, headers: base({ 'x-client-transaction-id': mint('GET', searchPath) }),
});
console.log(`  SearchTimeline     ${r2.status} len=${r2.text.length}${r2.status === 200 ? '  <-- WORKS' : ''}`);
