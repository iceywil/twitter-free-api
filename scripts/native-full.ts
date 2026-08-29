/** Fully native transaction-id generation: no browser anywhere. */
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { HttpSession } from '../src/internal/http.js';
import { ClientTransaction } from '../src/transaction/transaction.js';
import { TOKEN, FEATURES } from '../src/constants.js';
import { flattenParams } from '../src/utils.js';

const KEYWORD = 'obfiowerehiring';
const EPOCH = 1682924400;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const ct = new ClientTransaction();

const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const cookies = Object.fromEntries(
  st.cookies.filter((c: any) => c.domain.includes('x.com')).map((c: any) => [c.name, c.value])
);
const session = new HttpSession();
session.setCookies(cookies);

// 1. page: key + animation frames + webpack manifests
const html = (await session.request('GET', 'https://x.com/home', {
  headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
})).text;
const $ = cheerio.load(html);
const key = $("[name='twitter-site-verification']").attr('content')!;
const frames: string[] = [];
$("[id^='loading-x-anim']").each((_, el) => {
  const d = $(el).children().first().children().eq(1).attr('d');
  if (d) frames.push(d);
});
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

// 2. resolve ondemand.s through the chunk manifests
const objectAt = (s: string, from: number) => {
  const start = s.indexOf('{', from);
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return '';
};
const nameMap = objectAt(inline, inline.search(/\.u\s*=\s*\w*\s*=>/));
const id = [...nameMap.matchAll(/(\d{3,7}):"([^"]+)"/g)].find((m) => m[2] === 'ondemand.s')?.[1];
const hash = [...inline.matchAll(/(\d{3,7}):"([0-9a-f]{16})"/g)].find((m) => m[1] === id)?.[2];
const odUrl = `https://abs.twimg.com/responsive-web/client-web/ondemand.s.${hash}a.js`;
console.log(`ondemand.s -> chunk ${id}, ${odUrl.split('/').pop()}`);

// 3. indices
const od = (await session.request('GET', odUrl, { headers: { 'User-Agent': UA } })).text;
const indices = [...od.matchAll(/(\(\w{1}\[(\d{1,2})\],\s*16\))+/g)].map((m) => Number(m[2]));
console.log('indices:', indices);

// 4. animation key
const keyBytes = Array.from(Buffer.from(key, 'base64'));
const rowIndex = keyBytes[indices[0]] % 16;
const frameTime = indices.slice(1).reduce((acc, i) => acc * (keyBytes[i] % 16), 1);
const row = frames[keyBytes[5] % 4]
  .slice(9).split('C')
  .map((s) => s.replace(/[^\d]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number))[rowIndex];
const animationKey = ct.animate(row, frameTime / 4096);
console.log(`rowIndex=${rowIndex} frameTime=${frameTime}`);

// 5. mint + verify against gated endpoints
const mint = (method: string, path: string) => {
  const timeNow = Math.floor((Date.now() - EPOCH * 1000) / 1000);
  const timeBytes = [0, 1, 2, 3].map((i) => (timeNow >> (i * 8)) & 0xff);
  const h = Array.from(createHash('sha256').update(`${method}!${path}!${timeNow}${KEYWORD}${animationKey}`).digest());
  const r = randomBytes(1)[0];
  const arr = [...keyBytes, ...timeBytes, ...h.slice(0, 16), 3];
  return Buffer.from([r, ...arr.map((b) => b ^ r)]).toString('base64').replace(/=+$/, '');
};
const hdrs = (tid: string) => ({
  authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  'x-csrf-token': cookies.ct0, 'x-twitter-active-user': 'yes',
  'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-client-language': 'en',
  referer: 'https://x.com/', 'User-Agent': UA, 'x-client-transaction-id': tid,
});

console.log('\nNATIVE requests (no browser):');
const r1 = await session.request('GET', 'https://api.x.com/1.1/account/settings.json', {
  headers: hdrs(mint('GET', '/1.1/account/settings.json')),
});
console.log(`  settings.json    ${r1.status} len=${r1.text.length}${r1.status === 200 ? '  OK' : ''}`);

const sp = '/i/api/graphql/hyPfJYJ_XAtDYoslQc-Rgg/SearchTimeline';
const r2 = await session.request('GET', `https://x.com${sp}`, {
  params: flattenParams({
    variables: { rawQuery: 'typescript', count: 20, querySource: 'typed_query', product: 'Latest' },
    features: FEATURES,
  }),
  headers: hdrs(mint('GET', sp)),
});
console.log(`  SearchTimeline   ${r2.status} len=${r2.text.length}${r2.status === 200 ? '  OK' : ''}`);
