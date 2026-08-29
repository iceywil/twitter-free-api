import { readFileSync, writeFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const html = readFileSync('scripts/.home.html', 'utf-8');
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

/** Extracts the first balanced {...} object literal at or after `from`. */
function objectAt(s: string, from: number): string {
  const start = s.indexOf('{', from);
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return '';
}

// Name map: the first object literal inside webpack's r.u builder.
const uIdx = inline.search(/\.u\s*=\s*\w*\s*=>/);
const nameMap = objectAt(inline, uIdx);
const nameOf = new Map([...nameMap.matchAll(/(\d{3,7}):"([^"]+)"/g)].map((m) => [m[1], m[2]]));

// Hash map: values are exactly 16 hex chars.
const hashOf = new Map([...inline.matchAll(/(\d{3,7}):"([0-9a-f]{16})"/g)].map((m) => [m[1], m[2]]));

console.log(`name map entries: ${nameOf.size} | hash map entries: ${hashOf.size}`);

const id = '59924';
const name = nameOf.get(id) ?? id;
const hash = hashOf.get(id);
console.log(`chunk ${id}: name="${name}" hash=${hash}`);
const url = `https://abs.twimg.com/responsive-web/client-web/${name}.${hash}a.js`;
console.log('url:', url);

const session = new HttpSession();
const res = await session.request('GET', url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' },
});
console.log(`fetch: ${res.status}, ${res.text.length} bytes`);
if (res.status !== 200) process.exit(1);
writeFileSync('scripts/.ondemand.js', res.text);

const indices = [...res.text.matchAll(/(\(\w{1}\[(\d{1,2})\],\s*16\))+/g)].map((m) => Number(m[2]));
console.log('\nKEY_BYTE indices extracted:', indices);
if (indices.length) {
  console.log(`  rowIndex position   = ${indices[0]}  (independently recovered earlier: 5)`);
  console.log(`  frameTime positions = [${indices.slice(1)}]`);
}
