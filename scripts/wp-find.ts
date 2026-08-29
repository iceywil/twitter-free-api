import { readFileSync, readdirSync } from 'node:fs';
const main = readFileSync(`scripts/${readdirSync('scripts').find((f) => f.startsWith('.js-main'))!}`, 'utf-8');

// Body of the module holding the header call-site.
const start = main.indexOf('991160(e,t,r)');
const body = main.slice(start, start + 1400);

// Chunk ids requested via webpack's r.e(...)
const chunkIds = [...new Set([...body.matchAll(/\br\.e\((\d{3,7})\)/g)].map((m) => m[1]))];
console.log('dynamic chunk ids requested by the transaction module:', chunkIds.join(', ') || 'none');

// Module ids pulled out of the loaded chunk, e.g. .then(r.bind(r, <id>))
const boundIds = [...new Set([...body.matchAll(/r\.bind\(r,\s*(\d{4,7})\)/g)].map((m) => m[1]))];
console.log('module ids resolved from the chunk:', boundIds.join(', ') || 'none');

// Webpack chunk-filename builder: r.u = id => ... + {map}[id] + ".js"
const uIdx = main.search(/[a-zA-Z$_]\.u\s*=\s*[a-zA-Z$_]?\s*=>/);
if (uIdx !== -1) {
  const seg = main.slice(uIdx, uIdx + 900);
  const tmpl = seg.match(/=>\s*("[^"]*"|`[^`]*`)/)?.[1];
  console.log('\nchunk filename template head:', tmpl ?? '(inline)');
  // The id->hash manifest inside the builder
  const pairs = [...seg.matchAll(/(\d{3,7}):"([\w-]{5,})"/g)];
  console.log('manifest entries in builder:', pairs.length);
  for (const id of chunkIds) {
    const hit = pairs.find((p) => p[1] === id);
    console.log(`  chunk ${id} -> hash ${hit ? hit[2] : 'NOT IN THIS SEGMENT'}`);
  }
}

// Fall back: search the whole bundle for a manifest entry for our chunk ids.
for (const id of chunkIds) {
  const re = new RegExp(`${id}\\s*:\\s*"([\\w-]{5,})"`, 'g');
  const all = [...main.matchAll(re)].map((m) => m[1]);
  console.log(`\nglobal manifest lookups for ${id}:`, all.slice(0, 5).join(', ') || 'none');
}
