import { readFileSync, writeFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const html = readFileSync('scripts/.home.html', 'utf-8');
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

// Resolve chunk 59924 straight from the page's manifest.
const hash = [...inline.matchAll(/(\d{3,7}):"([0-9a-z]{15,18})"/g)].find((p) => p[1] === '59924')?.[2];
console.log('chunk 59924 hash from manifest:', hash);
const url = `https://abs.twimg.com/responsive-web/client-web/59924.${hash}a.js`;
console.log('url:', url);

const session = new HttpSession();
const res = await session.request('GET', url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' },
});
console.log(`fetch: ${res.status}, ${res.text.length} bytes`);
if (res.status !== 200) process.exit(1);
writeFileSync('scripts/.chunk59924.js', res.text);

const js = res.text;
// What does the generator need from its environment?
const NEEDS = [
  'document', 'querySelector', 'getElementsByTagName', 'createElement', 'lastElementChild',
  'crypto', 'subtle', 'digest', 'SHA-256', 'btoa', 'atob', 'window', 'navigator',
  'twitter-site-verification', 'loading-x-anim', 'obfiowerehiring', '4096',
];
console.log('\nenvironment surface referenced by the chunk:');
for (const n of NEEDS) {
  const c = [...js.matchAll(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length;
  if (c) console.log(`  ${n}: x${c}`);
}
console.log('\nmodule ids defined in the chunk:',
  [...new Set([...js.matchAll(/(?:^|[,{])\s*(\d{4,7})\s*(?::\s*\(|\()/g)].map((m) => m[1]))].join(', '));
