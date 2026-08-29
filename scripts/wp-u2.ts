import { readFileSync } from 'node:fs';
const html = readFileSync('scripts/.home.html', 'utf-8');
const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

console.log('=== every ".u=" assignment with context ===');
for (const m of inline.matchAll(/\.u\s*=/g)) {
  const i = m.index!;
  console.log(`\n@${i}: ${inline.slice(i, i + 260).replace(/\s+/g, ' ')}`);
}

console.log('\n=== all occurrences of 59924 in the inline runtime ===');
for (const m of inline.matchAll(/59924/g)) {
  const i = m.index!;
  console.log(`  @${i}: ...${inline.slice(Math.max(0, i - 90), i + 90).replace(/\s+/g, ' ')}...`);
}
