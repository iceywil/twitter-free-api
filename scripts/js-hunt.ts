import { writeFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const session = new HttpSession();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const html = (await session.request('GET', 'https://x.com', { headers: { 'User-Agent': UA } })).text;
const srcs = [...new Set([...html.matchAll(/src="(https:\/\/abs\.twimg\.com[^"]+\.js)"/g)].map((m) => m[1]))];

// Also check inline scripts in the HTML itself.
const inline = [...html.matchAll(/<script[^>]*>([\s\S]{200,}?)<\/script>/g)].map((m) => m[1]).join('\n');
const bundles: { name: string; js: string }[] = [{ name: 'inline-html', js: inline }];
for (const s of srcs) {
  bundles.push({ name: s.split('/').pop()!, js: (await session.request('GET', s, { headers: { 'User-Agent': UA } })).text });
}

const MARKERS = ['loading-x-anim', 'twitter-site-verification', '4096', 'obfiowerehiring', 'lastElementChild'];
for (const { name, js } of bundles) {
  const found = MARKERS.filter((m) => js.includes(m));
  console.log(`\n${name} (${js.length}b): ${found.length ? found.join(', ') : 'none'}`);
  for (const m of found) {
    if (m === '4096') continue;
    const i = js.indexOf(m);
    console.log(`  [${m}] ...${js.slice(Math.max(0, i - 150), i + 150).replace(/\s+/g, ' ')}...`);
  }
  if (found.includes('4096')) {
    const occ = [...js.matchAll(/4096/g)].map((mm) => mm.index!);
    console.log(`  [4096] ${occ.length} occurrence(s)`);
    for (const i of occ.slice(0, 3)) console.log(`     ...${js.slice(Math.max(0, i - 130), i + 90).replace(/\s+/g, ' ')}...`);
  }
  writeFileSync(`scripts/.js-${name}`, js);
}
