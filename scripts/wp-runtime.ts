import { readFileSync, writeFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const session = new HttpSession();
session.setCookies(Object.fromEntries(
  st.cookies.filter((c: any) => c.domain.includes('x.com')).map((c: any) => [c.name, c.value])
));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const html = (await session.request('GET', 'https://x.com/home', { headers: { 'User-Agent': UA } })).text;
writeFileSync('scripts/.home.html', html);

// All inline scripts on the logged-in page.
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
console.log(`inline scripts: ${inline.length}, total ${inline.reduce((a, s) => a + s.length, 0)} bytes`);

const joined = inline.join('\n');
// Does the runtime + manifest live here?
const pairs = [...joined.matchAll(/(\d{3,7}):"([0-9a-z]{15,18})"/g)];
console.log(`chunk id:"hash" pairs in inline scripts: ${pairs.length}`);
if (pairs.length) {
  console.log('  samples:', pairs.slice(0, 3).map((p) => `${p[1]}->${p[2]}`).join(', '));
  const t = pairs.find((p) => p[1] === '59924');
  console.log(`  chunk 59924: ${t ? t[2] : 'NOT PRESENT'}`);
}
for (const marker of ['a.js', 'client-web/', 'webpackChunk', '.u=']) {
  console.log(`  contains ${JSON.stringify(marker)}: ${joined.includes(marker)}`);
}
// Any additional script srcs we have not fetched?
const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
console.log('\nscript srcs on the page:');
srcs.forEach((s) => console.log('  ', s.replace('https://abs.twimg.com/', '')));
