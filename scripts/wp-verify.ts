import { readFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const html = readFileSync('scripts/.home.html', 'utf-8');
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const pairs = [...inline.matchAll(/(\d{3,7}):"([0-9a-z]{15,18})"/g)];

// Does 59924 appear more than once (multiple manifests)?
const mine = pairs.filter((p) => p[1] === '59924').map((p) => p[2]);
console.log('hashes mapped to 59924:', mine.join(', ') || 'none');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const session = new HttpSession();
const tryUrl = async (u: string) => {
  const r = await session.request('GET', u, { headers: { 'User-Agent': UA } });
  return `${r.status} ${r.text.length}b`;
};

// Validate the pattern on three arbitrary manifest entries.
console.log('\npattern check on arbitrary manifest entries (<id>.<hash>a.js):');
for (const p of pairs.slice(0, 3)) {
  console.log(`  ${p[1]}: ${await tryUrl(`https://abs.twimg.com/responsive-web/client-web/${p[1]}.${p[2]}a.js`)}`);
}

console.log('\nvariants for 59924:');
for (const h of mine.length ? mine : ['c6d5581b0b1c0bc6']) {
  for (const suffix of ['a.js', '.js']) {
    console.log(`  ${h}${suffix}: ${await tryUrl(`https://abs.twimg.com/responsive-web/client-web/59924.${h}${suffix}`)}`);
  }
}
