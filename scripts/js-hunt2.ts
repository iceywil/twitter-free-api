import { readFileSync, writeFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const session = new HttpSession();
session.setCookies(Object.fromEntries(st.cookies.filter((c: any) => c.domain.includes('x.com')).map((c: any) => [c.name, c.value])));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const html = (await session.request('GET', 'https://x.com/home', { headers: { 'User-Agent': UA } })).text;
const srcs = [...new Set([...html.matchAll(/src="(https:\/\/abs\.twimg\.com[^"]+\.js)"/g)].map((m) => m[1]))];
console.log('bundles:', srcs.map((s) => s.split('/').pop()).join(', '));

const MARKERS = ['loading-x-anim', 'twitter-site-verification', 'obfiowerehiring', 'lastElementChild', 'x-client-transaction-id'];
for (const s of srcs) {
  const js = (await session.request('GET', s, { headers: { 'User-Agent': UA } })).text;
  const name = s.split('/').pop()!;
  const found = MARKERS.filter((m) => js.includes(m));
  const n4096 = [...js.matchAll(/4096/g)].length;
  console.log(`\n${name} (${js.length}b) markers: ${found.join(', ') || 'none'} | 4096 x${n4096}`);
  for (const m of found) {
    const i = js.indexOf(m);
    console.log(`  [${m}] ...${js.slice(Math.max(0, i - 200), i + 200).replace(/\s+/g, ' ')}...`);
  }
  writeFileSync(`scripts/.js-${name}`, js);
}
