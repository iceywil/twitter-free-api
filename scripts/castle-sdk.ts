import { readFileSync, writeFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const html = readFileSync('scripts/.home.html', 'utf-8');
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

const objectAt = (s: string, from: number) => {
  const st = s.indexOf('{', from); let d = 0;
  for (let i = st; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return s.slice(st, i + 1); }
  return '';
};
const nameMap = objectAt(inline, inline.search(/\.u\s*=\s*\w*\s*=>/));
const nameOf = new Map([...nameMap.matchAll(/(\d{3,7}):"([^"]+)"/g)].map((m) => [m[1], m[2]]));
const hashOf = new Map([...inline.matchAll(/(\d{3,7}):"([0-9a-f]{16})"/g)].map((m) => [m[1], m[2]]));

// Also grab the publishable key if it is present in the page config.
const pk = /responsive_web_castle_public_key[^a-zA-Z0-9]{0,30}([A-Za-z0-9_-]{6,40})/.exec(inline)?.[1];
console.log('castle publishable key from page config:', pk ?? '(not in page)');

const id = '15793';
const name = nameOf.get(id) ?? id;
const hash = hashOf.get(id);
const url = `https://abs.twimg.com/responsive-web/client-web/${name}.${hash}a.js`;
console.log(`chunk ${id}: name="${name}" hash=${hash}`);

const session = new HttpSession();
const res = await session.request('GET', url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' },
});
console.log(`fetch: ${res.status}, ${res.text.length} bytes`);
if (res.status !== 200) process.exit(1);
writeFileSync('scripts/.castle.js', res.text);

const js = res.text;
const MARKERS = [
  'pako', 'deflate', 'gzip', 'inflate', 'AES', 'aes', 'crypto', 'subtle', 'importKey',
  'encrypt', 'RSA', 'publicKey', 'nacl', 'tweetnacl', 'chacha', 'sodium',
  'canvas', 'webgl', 'WebGL', 'userAgent', 'screen', 'timezone', 'JSON.stringify', 'btoa',
];
console.log('\nwhat the SDK uses:');
for (const m of MARKERS) {
  const c = [...js.matchAll(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length;
  if (c) console.log(`  ${m}: x${c}`);
}
