import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { HttpSession } from '../src/internal/http.js';
import { ClientTransaction } from '../src/transaction/transaction.js';
import { TOKEN } from '../src/constants.js';

const KEYWORD = 'obfiowerehiring';
const EPOCH = 1682924400;
const ct = new ClientTransaction();
const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const cookies = Object.fromEntries(
  st.cookies.filter((c: any) => c.domain.includes('x.com')).map((c: any) => [c.name, c.value])
);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const session = new HttpSession();
session.setCookies(cookies);

// Fetch the page natively — no browser anywhere.
const html = (await session.request('GET', 'https://x.com/home', {
  headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
})).text;

const $ = cheerio.load(html);
const key = $("[name='twitter-site-verification']").attr('content');
const frames: string[] = [];
$("[id^='loading-x-anim']").each((_, el) => {
  const d = $(el).children().first().children().eq(1).attr('d');
  if (d) frames.push(d);
});
console.log(`native fetch: key=${key ? 'yes' : 'NO'} frames=${frames.length}`);
if (!key || frames.length < 4) process.exit(1);

const keyBytes = Array.from(Buffer.from(key, 'base64'));
const rowIndex = keyBytes[5] % 16;
const row = frames[keyBytes[5] % 4]
  .slice(9).split('C')
  .map((i) => i.replace(/[^\d]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number))[rowIndex];

const mint = (method: string, path: string, animationKey: string): string => {
  const timeNow = Math.floor((Date.now() - EPOCH * 1000) / 1000);
  const timeBytes = [0, 1, 2, 3].map((i) => (timeNow >> (i * 8)) & 0xff);
  const hash = Array.from(createHash('sha256').update(`${method}!${path}!${timeNow}${KEYWORD}${animationKey}`).digest());
  const r = randomBytes(1)[0];
  const arr = [...keyBytes, ...timeBytes, ...hash.slice(0, 16), 3];
  return Buffer.from([r, ...arr.map((b) => b ^ r)]).toString('base64').replace(/=+$/, '');
};

const URL = 'https://api.x.com/1.1/account/settings.json';
const PATH = '/1.1/account/settings.json';
const headers = (tid: string) => ({
  authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  'x-csrf-token': cookies.ct0, 'x-twitter-active-user': 'yes',
  'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-client-language': 'en',
  referer: 'https://x.com/', 'User-Agent': UA, 'x-client-transaction-id': tid,
});

console.log('\nDoes the server verify the animation key?');
for (const ft of [0, 1, 137, 2048]) {
  const ak = ct.animate(row, ft / 4096);
  const r = await session.request('GET', URL, { headers: headers(mint('GET', PATH, ak)) });
  console.log(`  frameTime=${String(ft).padStart(4)} -> ${r.status} len=${r.text.length}${r.status === 200 ? '  <-- ACCEPTED' : ''}`);
}
// Control: a structurally valid id with a garbage animation key.
const r = await session.request('GET', URL, { headers: headers(mint('GET', PATH, 'deadbeef00'.repeat(6))) });
console.log(`  garbage animKey -> ${r.status} len=${r.text.length}${r.status === 200 ? '  <-- ACCEPTED (not verified!)' : ''}`);
