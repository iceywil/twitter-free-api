import { readFileSync } from 'node:fs';
const js = readFileSync('scripts/.castle.js', 'utf-8');

console.log('chunk head (first 220 chars):');
console.log('  ' + js.slice(0, 220).replace(/\s+/g, ' '));

// Module ids defined in this chunk
const ids = [...new Set([...js.matchAll(/(?:^|[,{])\s*(\d{4,7})\s*:\s*(?:function\s*)?\(/g)].map((m) => m[1]))];
console.log('\nmodule ids defined:', ids.join(', ') || '(pattern not matched)');

// Does module 855881 exist, and what does it require?
const i = js.indexOf('855881');
console.log('\n855881 present:', i !== -1);
if (i !== -1) {
  const seg = js.slice(i, i + 400);
  console.log('  head:', seg.slice(0, 200).replace(/\s+/g, ' '));
  // webpack require calls inside the whole chunk
  const reqs = [...new Set([...js.matchAll(/\b[a-zA-Z_$]\((\d{5,7})\)/g)].map((m) => m[1]))];
  console.log('  numeric require-like calls in chunk:', reqs.slice(0, 15).join(', ') || 'none');
}

// Environment APIs the SDK touches (to size the shim)
const APIS = ['document.createElement', 'getContext', 'WebGLRenderingContext', 'CompressionStream',
  'navigator.userAgent', 'navigator.', 'window.', 'screen.', 'localStorage', 'sessionStorage',
  'indexedDB', 'performance.', 'addEventListener', 'XMLHttpRequest', 'fetch('];
console.log('\nenvironment APIs referenced:');
for (const a of APIS) {
  const c = [...js.matchAll(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length;
  if (c) console.log(`  ${a}: x${c}`);
}
console.log('\nexports "configure":', js.includes('configure'));
