import { readFileSync, writeFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const html = readFileSync('scripts/.home.html', 'utf-8');
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

// Two manifests: id -> name, and id -> contenthash.
const nameOf = new Map([...inline.matchAll(/(\d{3,7}):"([A-Za-z0-9._\/-]{3,40})"/g)].map((m) => [m[1], m[2]]));
const hashOf = new Map([...inline.matchAll(/(\d{3,7}):"([0-9a-f]{16})"/g)].map((m) => [m[1], m[2]]));

const id = '59924';
const name = nameOf.get(id) ?? id;
const hash = hashOf.get(id);
const url = `https://abs.twimg.com/responsive-web/client-web/${name}.${hash}a.js`;
console.log(`chunk ${id}: name="${name}" hash=${hash}`);
console.log('url:', url);

const session = new HttpSession();
const res = await session.request('GET', url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' },
});
console.log(`fetch: ${res.status}, ${res.text.length} bytes`);
if (res.status !== 200) process.exit(1);
writeFileSync('scripts/.ondemand.js', res.text);

// twikit's KEY_BYTE index extraction, applied to the real file.
const INDICES = /(\(\w{1}\[(\d{1,2})\],\s*16\))+/g;
const indices = [...res.text.matchAll(INDICES)].map((m) => Number(m[2]));
console.log('\nKEY_BYTE indices extracted:', indices);
if (indices.length) {
  console.log(`  rowIndex position  = ${indices[0]}   (independently recovered: 5)`);
  console.log(`  frameTime positions = [${indices.slice(1)}]`);
}
