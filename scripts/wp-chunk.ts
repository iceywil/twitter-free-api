import { readFileSync, readdirSync } from 'node:fs';

const files = readdirSync('scripts').filter((f) => f.startsWith('.js-'));
for (const f of files) {
  const js = readFileSync(`scripts/${f}`, 'utf-8');
  const hits = [...js.matchAll(/186515/g)].length;
  console.log(`${f}: mentions 186515 x${hits}`);
  if (hits) {
    const i = js.indexOf('186515');
    console.log(`  ...${js.slice(Math.max(0, i - 220), i + 120).replace(/\s+/g, ' ')}...`);
  }
}

// The chunk filename template: webpack builds it in __webpack_require__.u
const main = readFileSync(`scripts/${files.find((f) => f.startsWith('.js-main'))!}`, 'utf-8');
console.log('\n=== chunk URL construction ===');
for (const pat of [/\.u\s*=\s*[^;]{0,400}/g, /"\.js"/g, /ondemand/gi]) {
  const m = [...main.matchAll(pat)].slice(0, 2);
  for (const x of m) console.log(`  ${String(x[0]).replace(/\s+/g, ' ').slice(0, 320)}`);
}
console.log('\n=== chunk id -> hash maps (samples) ===');
const maps = [...main.matchAll(/\{(?:\s*\d{4,7}\s*:\s*"[\w-]{6,}"\s*,){3,}/g)].slice(0, 2);
for (const m of maps) console.log(`  ${m[0].slice(0, 300)}...`);
