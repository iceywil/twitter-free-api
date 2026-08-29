import { readFileSync } from 'node:fs';
import { ClientTransaction } from '../src/transaction/transaction.js';

const obs: { keyBytes: number[]; frames: string[]; rowIndex: number; frameTime: number }[] =
  JSON.parse(readFileSync('scripts/.tid-obs.json', 'utf-8'));
const ct = new ClientTransaction();
const parseFrame = (d: string) =>
  d.slice(9).split('C').map((i) => i.replace(/[^\d]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number));

// For each load, the full set of frameTime values yielding the same animation key.
const classes = obs.map((o) => {
  const row = parseFrame(o.frames[o.keyBytes[5] % 4])[o.rowIndex];
  const want = ct.animate(row, o.frameTime / 4096);
  const set = new Set<number>();
  for (let ft = 0; ft < 4096; ft++) if (ct.animate(row, ft / 4096) === want) set.add(ft);
  return set;
});
classes.forEach((s, i) => console.log(`  load ${i + 1}: recovered ft=${obs[i].frameTime}, equivalence class size=${s.size}`));

const N = 48;
const nib = (o: typeof obs[0], p: number) => o.keyBytes[p] % 16;
const ok = (f: (o: typeof obs[0]) => number) => obs.every((o, i) => classes[i].has(f(o)));

const hits: string[] = [];
for (let a = 0; a < N; a++) {
  for (let b = 0; b < N; b++) {
    if (ok((o) => nib(o, a) * nib(o, b))) hits.push(`n${a}*n${b}`);
    for (let c = 0; c < N; c++) {
      if (ok((o) => nib(o, a) * nib(o, b) * nib(o, c))) hits.push(`n${a}*n${b}*n${c}`);
    }
  }
}
console.log(`\nnibble-product formulas landing inside every class: ${hits.length}`);
console.log(hits.slice(0, 20).join('  '));
