import { readFileSync } from 'node:fs';
const obs: { keyBytes: number[]; rowIndex: number; frameTime: number }[] =
  JSON.parse(readFileSync('scripts/.tid-obs.json', 'utf-8'));
const N = 48;
const all = (f: (o: typeof obs[0]) => number) => obs.every((o) => f(o) === o.frameTime);
const hits: string[] = [];

// 3-byte products, mod 4096
for (let a = 0; a < N && hits.length < 5; a++)
  for (let b = 0; b < N; b++)
    for (let c = 0; c < N; c++)
      if (all((o) => (o.keyBytes[a] * o.keyBytes[b] * o.keyBytes[c]) % 4096))
        hits.push(`b${a}*b${b}*b${c} %4096`);

// nibble * byte, nibble * 16-bit, and shifted combinations
for (let a = 0; a < N; a++)
  for (let b = 0; b < N - 1; b++) {
    if (all((o) => ((o.keyBytes[a] % 16) * ((o.keyBytes[b] << 8) | o.keyBytes[b + 1])) % 4096))
      hits.push(`n${a}*BE16@${b} %4096`);
    if (all((o) => (((o.keyBytes[a] % 16) << 8 | o.keyBytes[b]) % 4096)))
      hits.push(`n${a}<<8|b${b}`);
  }

// 12-bit reads at every bit offset across the whole key
const bitsOf = (kb: number[]) => kb.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >> i) & 1));
for (let off = 0; off + 12 <= 48 * 8; off++) {
  if (all((o) => bitsOf(o.keyBytes).slice(off, off + 12).reduce((a, b) => a * 2 + b, 0)))
    hits.push(`12-bit BE @bit${off}`);
  if (all((o) => bitsOf(o.keyBytes).slice(off, off + 12).reverse().reduce((a, b) => a * 2 + b, 0)))
    hits.push(`12-bit LE @bit${off}`);
}

// sums of byte subsets (pairs/triples) mod 4096
for (let a = 0; a < N; a++)
  for (let b = 0; b < N; b++)
    for (let c = 0; c < N; c++)
      if (all((o) => (o.keyBytes[a] + o.keyBytes[b] + o.keyBytes[c]) % 4096))
        hits.push(`b${a}+b${b}+b${c}`);

console.log('observations:', obs.length);
console.log('matches:', hits.length ? hits.slice(0, 8) : 'NONE across 3-byte products, nibble*16bit, all 12-bit reads, 3-byte sums');
