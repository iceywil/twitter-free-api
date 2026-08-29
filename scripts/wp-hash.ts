import { readFileSync, readdirSync } from 'node:fs';
const files = readdirSync('scripts').filter((f) => f.startsWith('.js-'));
const KNOWN = 'f8ed13ac6dd54fa9'; // from client-web/10106.f8ed13ac6dd54fa9a.js

for (const f of files) {
  const js = readFileSync(`scripts/${f}`, 'utf-8');
  const i = js.indexOf(KNOWN);
  console.log(`${f}: known hash ${i === -1 ? 'absent' : `at ${i}`}`);
  if (i !== -1) {
    console.log(`  context: ...${js.slice(Math.max(0, i - 260), i + 120).replace(/\s+/g, ' ')}...`);
    // How many id:"hash" pairs live in this manifest region?
    const region = js.slice(Math.max(0, i - 40000), i + 40000);
    const pairs = [...region.matchAll(/(\d{3,7}):"([0-9a-f]{15,18})"/g)];
    console.log(`  id:"hash" pairs near it: ${pairs.length}`);
    const target = pairs.find((p) => p[1] === '59924');
    console.log(`  chunk 59924 in manifest: ${target ? target[2] : 'not found'}`);
  }
}
