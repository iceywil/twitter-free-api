import { readFileSync, readdirSync } from 'node:fs';
const files = readdirSync('scripts').filter((f) => f.startsWith('.js-'));

console.log('=== searching every bundle for chunk 59924 / module 208932 ===');
for (const f of files) {
  const js = readFileSync(`scripts/${f}`, 'utf-8');
  const c = [...js.matchAll(/59924/g)].length;
  const m = [...js.matchAll(/208932/g)].length;
  if (c || m) {
    console.log(`${f}: 59924 x${c}, 208932 x${m}`);
    const i = js.indexOf('59924');
    if (i !== -1) console.log(`  ...${js.slice(Math.max(0, i - 160), i + 160).replace(/\s+/g, ' ')}...`);
  }
}

console.log('\n=== abs.twimg URL templates (how chunk files are addressed) ===');
const main = readFileSync(`scripts/${files.find((f) => f.startsWith('.js-main'))!}`, 'utf-8');
const seen = new Set<string>();
for (const m of main.matchAll(/["'`][^"'`]{0,60}abs\.twimg\.com[^"'`]{0,80}["'`]/g)) {
  if (!seen.has(m[0])) { seen.add(m[0]); console.log('  ', m[0]); }
  if (seen.size > 8) break;
}
for (const m of main.matchAll(/["'`][^"'`]{0,40}client-web[^"'`]{0,60}["'`]/g)) {
  if (!seen.has(m[0])) { seen.add(m[0]); console.log('  ', m[0]); }
  if (seen.size > 14) break;
}
