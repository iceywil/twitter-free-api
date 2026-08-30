import { readFileSync } from 'node:fs';
const js = readFileSync('scripts/.castle.js', 'utf-8');

const win = (i: number, before = 130, after = 150) =>
  js.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' ');

console.log('=== RSA / crypto references in context ===');
for (const kw of ['RSA', 'crypto', 'deflate']) {
  const i = js.indexOf(kw);
  if (i !== -1) console.log(`\n[${kw}] ...${win(i)}...`);
}

console.log('\n=== how the token string is assembled (pipe separator) ===');
let n = 0;
for (const m of js.matchAll(/["'`]\|["'`]/g)) {
  console.log(`\n@${m.index} ...${win(m.index!, 160, 120)}...`);
  if (++n >= 3) break;
}

console.log('\n=== btoa call sites (encoding step) ===');
n = 0;
for (const m of js.matchAll(/btoa\(/g)) {
  console.log(`\n@${m.index} ...${win(m.index!, 150, 90)}...`);
  if (++n >= 3) break;
}
