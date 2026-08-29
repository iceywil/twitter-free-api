import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { ClientTransaction } from '../src/transaction/transaction.js';

const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const KEYWORD = 'obfiowerehiring';
const TOTAL = 4096;
const ct = new ClientTransaction();

const parseFrame = (d: string): number[][] =>
  d.slice(9).split('C').map((item) =>
    item.replace(/[^\d]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number)
  );

interface Load { keyBytes: number[]; frames: string[]; rowIndex: number; frameTime: number }
const loads: Load[] = [];

const browser = await chromium.launch({ headless: true });

for (let i = 0; i < 8; i++) {
  const context = await browser.newContext({ storageState: st, locale: 'en-US' });
  const page = await context.newPage();
  let rawHtml: string | null = null;
  let sample: { method: string; path: string; tid: string } | null = null;

  page.on('response', async (res) => {
    if (rawHtml || res.request().resourceType() !== 'document') return;
    rawHtml = await res.text().catch(() => null);
  });
  page.on('request', async (req) => {
    if (sample) return;
    const u = req.url();
    if (!/x\.com\/i\/api\/|api\.x\.com\//.test(u)) return;
    const h = await req.allHeaders().catch(() => ({} as Record<string, string>));
    if (h['x-client-transaction-id']) {
      sample = { method: req.method(), path: new URL(u).pathname, tid: h['x-client-transaction-id'] };
    }
  });

  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await context.close();

  if (!rawHtml || !sample) { console.log(`  load ${i + 1}: incomplete, skipped`); continue; }

  const $ = cheerio.load(rawHtml);
  const key = $("[name='twitter-site-verification']").attr('content');
  const frames: string[] = [];
  $("[id^='loading-x-anim']").each((_, el) => {
    const d = $(el).children().first().children().eq(1).attr('d');
    if (d) frames.push(d);
  });
  if (!key || frames.length < 4) { console.log(`  load ${i + 1}: no key/frames`); continue; }

  const keyBytes = Array.from(Buffer.from(key, 'base64'));
  const s = sample as { method: string; path: string; tid: string };
  const raw = Buffer.from(s.tid + '='.repeat((4 - (s.tid.length % 4)) % 4), 'base64');
  const rnd = raw[0];
  const body = Buffer.from(raw.subarray(1).map((b) => b ^ rnd));
  const timeNow = body.readUInt32LE(48);
  const targetHash = body.subarray(52, 68).toString('hex');

  const arr = parseFrame(frames[keyBytes[5] % 4]);
  let solved: { rowIndex: number; frameTime: number } | null = null;
  outer: for (let row = 0; row < Math.min(16, arr.length); row++) {
    if (arr[row].length < 8) continue;
    for (let ft = 0; ft < TOTAL; ft++) {
      const ak = ct.animate(arr[row], ft / TOTAL);
      const h = createHash('sha256')
        .update(`${s.method}!${s.path}!${timeNow}${KEYWORD}${ak}`)
        .digest('hex')
        .slice(0, 32);
      if (h === targetHash) { solved = { rowIndex: row, frameTime: ft }; break outer; }
    }
  }

  if (!solved) { console.log(`  load ${i + 1}: unsolved`); continue; }
  console.log(`  load ${i + 1}: rowIndex=${solved.rowIndex} frameTime=${solved.frameTime}`);
  loads.push({ keyBytes, frames, ...solved });
}
await browser.close();

// Persist observations so the formula search has a growing dataset.
const OBS = 'scripts/.tid-obs.json';
const merged = [...loads.map((l) => ({ keyBytes: l.keyBytes, frames: l.frames, rowIndex: l.rowIndex, frameTime: l.frameTime }))];
writeFileSync(OBS, JSON.stringify(merged));
console.log(`observations saved: ${merged.length} total`);

console.log(`\nsolved ${loads.length} loads. Recovering byte positions:`);

// rowIndex = keyBytes[p] % 16, consistent across every load
const rowPos = [...Array(48).keys()].filter((p) =>
  loads.every((l) => l.keyBytes[p] % 16 === l.rowIndex)
);
console.log('  rowIndex positions consistent with all loads:', rowPos);

// frameTime = product of keyBytes[i] % 16 over some position set
const nib = (l: Load, p: number) => l.keyBytes[p] % 16;
const sets: number[][] = [];
for (let a = 0; a < 48; a++) {
  for (let b = 0; b < 48; b++) {
    if (loads.every((l) => nib(l, a) * nib(l, b) === l.frameTime)) sets.push([a, b]);
    for (let c = 0; c < 48; c++) {
      if (loads.every((l) => nib(l, a) * nib(l, b) * nib(l, c) === l.frameTime)) sets.push([a, b, c]);
    }
  }
}
console.log('  frameTime position sets consistent with all loads:', sets.slice(0, 12));
console.log('  (total candidate sets:', sets.length, ')');
