import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const file = readdirSync('scripts').find((f) => f.startsWith('.js-main'))!;
const js = readFileSync(`scripts/${file}`, 'utf-8');
console.log(`bundle: ${file} (${js.length} bytes)`);

// Webpack module boundaries: `<id>:(e,t,r)=>{` or `<id>(e,t,r){`
const MODULE = /(?:^|[,{])\s*(\d{4,7})\s*(?::\s*\(([^)]{0,30})\)\s*=>\s*\{|\(([^)]{0,30})\)\s*\{)/g;
const bounds: { id: string; start: number }[] = [];
for (const m of js.matchAll(MODULE)) bounds.push({ id: m[1], start: m.index! });
console.log(`module boundaries found: ${bounds.length}`);

const moduleAt = (pos: number) => {
  let lo = 0, hi = bounds.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid].start <= pos) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
};

const src = (i: number) => js.slice(bounds[i].start, i + 1 < bounds.length ? bounds[i + 1].start : js.length);

const marker = 'x-client-transaction-id';
const pos = js.indexOf(marker);
const idx = moduleAt(pos);
console.log(`\n"${marker}" is inside module ${bounds[idx].id} (${src(idx).length} bytes)`);

// Its webpack requires
const body = src(idx);
const reqs = [...new Set([...body.matchAll(/\br\((\d{4,7})\)/g)].map((m) => m[1]))];
console.log('  requires:', reqs.join(', ') || '(none)');

// Which of those defines the generator? Look for the algorithm's fingerprints.
const FINGERPRINTS = ['sha256', 'SHA-256', 'crypto.subtle', 'digest', 'btoa', 'querySelector', 'charCodeAt', 'fromCharCode'];
const byId = new Map<string, number>();
bounds.forEach((b, i) => byId.set(b.id, i));

console.log('\nscanning required modules for algorithm fingerprints:');
for (const id of reqs) {
  const i = byId.get(id);
  if (i === undefined) { console.log(`  ${id}: not found in map`); continue; }
  const s = src(i);
  const hits = FINGERPRINTS.filter((f) => s.includes(f));
  console.log(`  ${id} (${s.length}b): ${hits.join(', ') || '-'}`);
}

// Global search: which modules mention the DOM + hashing together?
console.log('\nmodules mentioning both a meta lookup and hashing:');
const cands: string[] = [];
bounds.forEach((b, i) => {
  const s = src(i);
  if (s.length > 400_000) return;
  const dom = s.includes('querySelector') || s.includes('getElementsByTagName');
  const hash = s.includes('digest') || s.includes('SHA-256') || s.includes('sha256');
  if (dom && hash) cands.push(`${b.id}(${s.length}b)`);
});
console.log(' ', cands.slice(0, 20).join('  ') || 'none');
writeFileSync('scripts/.wp-map.json', JSON.stringify(bounds));
