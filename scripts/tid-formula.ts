import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Persisted (keyBytes, rowIndex, frameTime) observations.
const DATA = 'scripts/.tid-obs.json';
if (!existsSync(DATA)) { console.log('no observations file'); process.exit(1); }
const obs: { keyBytes: number[]; rowIndex: number; frameTime: number }[] = JSON.parse(readFileSync(DATA, 'utf-8'));
console.log(`observations: ${obs.length}`);
console.log('frameTimes:', obs.map((o) => o.frameTime).join(', '));

const N = 48;
const hits: string[] = [];
const all = (f: (o: typeof obs[0]) => number) => obs.every((o) => f(o) === o.frameTime);

// 1) 16-bit reads, little and big endian, masked/modded
for (let a = 0; a < N - 1; a++) {
  if (all((o) => ((o.keyBytes[a] | (o.keyBytes[a + 1] << 8)) & 0xfff))) hits.push(`LE16 @${a} & 0xfff`);
  if (all((o) => (((o.keyBytes[a] << 8) | o.keyBytes[a + 1]) & 0xfff))) hits.push(`BE16 @${a} & 0xfff`);
  if (all((o) => ((o.keyBytes[a] | (o.keyBytes[a + 1] << 8)) % 4096))) hits.push(`LE16 @${a} % 4096`);
}
// 2) products / sums of two or three whole bytes, mod 4096
for (let a = 0; a < N; a++) {
  if (all((o) => o.keyBytes[a] % 4096)) hits.push(`byte @${a}`);
  for (let b = 0; b < N; b++) {
    if (all((o) => (o.keyBytes[a] * o.keyBytes[b]) % 4096)) hits.push(`b${a}*b${b} % 4096`);
    if (all((o) => (o.keyBytes[a] + o.keyBytes[b]) % 4096)) hits.push(`b${a}+b${b}`);
    if (all((o) => ((o.keyBytes[a] % 16) * o.keyBytes[b]) % 4096)) hits.push(`n${a}*b${b} % 4096`);
    if (all((o) => (o.keyBytes[a] % 16) * (o.keyBytes[b] % 16) * (o.keyBytes[(a + b) % N] % 16))) hits.push(`nib triple ${a},${b}`);
  }
}
// 3) nibble * byte pairs and nibble-weighted combos
for (let a = 0; a < N; a++) {
  for (let b = 0; b < N; b++) {
    for (const m of [256, 4096, 1024]) {
      if (all((o) => ((o.keyBytes[a] % 16) * (o.keyBytes[b] % 16) * 16) % m)) hits.push(`n${a}*n${b}*16 %${m}`);
    }
  }
}

console.log('\nmatching formulas:', hits.length ? hits.slice(0, 10) : 'NONE');
if (!hits.length) {
  // Report factorisations to guide the next hypothesis.
  console.log('\nfactorisations (max prime factor):');
  for (const o of obs) {
    let n = o.frameTime, f: number[] = [];
    for (let p = 2; p * p <= n; p++) while (n % p === 0) { f.push(p); n /= p; }
    if (n > 1) f.push(n);
    console.log(`  ${String(o.frameTime).padStart(5)} = ${f.join(' x ') || '0'}   maxFactor=${Math.max(...f, 0)}`);
  }
}
