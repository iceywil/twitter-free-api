import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Impit } from 'impit';
import { HttpSession } from '../src/internal/http.js';

const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: st, locale: 'en-US' });
const page = await context.newPage();

// Capture a real request to settings.json, headers and all.
let captured: { url: string; headers: Record<string, string> } | null = null;
page.on('request', async (req) => {
  if (captured) return;
  if (!/account\/settings\.json/.test(req.url())) return;
  captured = { url: req.url(), headers: await req.allHeaders().catch(() => ({})) };
});

await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(6000);

// Confirm the browser itself succeeds on it.
const inPage = await page.evaluate(async (u) => {
  const r = await fetch(u, { credentials: 'include' });
  return { status: r.status, len: (await r.text()).length };
}, 'https://api.x.com/1.1/account/settings.json');
console.log(`in-page fetch (browser, no explicit tid): ${inPage.status} len=${inPage.len}`);

await browser.close();

if (!captured) {
  console.log('did not capture a settings.json request');
  process.exit(1);
}

const cap = captured as { url: string; headers: Record<string, string> };
const tid = cap.headers['x-client-transaction-id'];
console.log(`captured tid: ${tid ? `<${tid.length} chars>` : 'NONE'}  age: <1s`);

const headers: Record<string, string> = {};
for (const [k, v] of Object.entries(cap.headers)) {
  if (k.startsWith(':')) continue;
  headers[k] = v;
}
headers['accept-encoding'] = 'gzip, deflate, br';

console.log('\nReplaying immediately with the FRESH tid:');
const node = new HttpSession();
const nr = await node.request('GET', cap.url, { headers });
console.log(`  plain Node        ${nr.status} len=${nr.text.length}${nr.status === 200 ? '  <-- WORKS' : ''}`);

const impit = new Impit({ browser: 'chrome' });
const ir = await impit.fetch(cap.url, { headers });
const itext = await ir.text();
console.log(`  impit (chrome TLS) ${ir.status} len=${itext.length}${ir.status === 200 ? '  <-- WORKS' : ''}`);

// And without the tid, to isolate its contribution.
const noTid = { ...headers };
delete noTid['x-client-transaction-id'];
const ir2 = await impit.fetch(cap.url, { headers: noTid });
console.log(`  impit, no tid      ${ir2.status} len=${(await ir2.text()).length}`);
