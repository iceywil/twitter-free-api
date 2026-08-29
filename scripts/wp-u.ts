import { readFileSync, readdirSync } from 'node:fs';
const main = readFileSync(`scripts/${readdirSync('scripts').find((f) => f.startsWith('.js-main'))!}`, 'utf-8');

// Where is the chunk filename assembled? Look for the ".js" suffix concatenations.
console.log('=== ".js" / "a.js" concatenation sites ===');
let shown = 0;
for (const m of main.matchAll(/\+\s*"[a-z]?\.js"/g)) {
  const i = m.index!;
  console.log(`  @${i}: ...${main.slice(Math.max(0, i - 300), i + 40).replace(/\s+/g, ' ')}...`);
  if (++shown >= 4) break;
}

console.log('\n=== how many numeric->string maps exist, by value shape ===');
for (const [label, re] of [
  ['16-hex', /(\d{3,7}):"[0-9a-f]{16}"/g],
  ['17-char', /(\d{3,7}):"[0-9a-z]{17}"/g],
  ['any-quoted', /(\d{3,7}):"[0-9a-zA-Z_-]{8,20}"/g],
] as const) {
  const all = [...main.matchAll(re)];
  console.log(`  ${label}: ${all.length} pairs`);
  if (all.length) {
    const has = all.find((p) => p[1] === '59924');
    console.log(`    contains 59924: ${has ? has[0] : 'no'}`);
  }
}
