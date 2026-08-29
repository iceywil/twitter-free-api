import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from '../src/index.js';
import { flattenParams } from '../src/utils.js';

const features = JSON.parse(readFileSync('scripts/.explore-features.json', 'utf-8'));
const client = new Client({ silent: true });
client.setCookies({
  auth_token: process.env.TWITTER_AUTH_TOKEN!,
  ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)!,
});

const [resp] = await client.get('https://x.com/i/api/graphql/qjhLfJKwuRiKMQ6zBgkfYQ/ExploreSidebar', {
  params: flattenParams({ variables: {}, features }),
  headers: client.baseHeaders,
} as any);
writeFileSync('scripts/.explore-sidebar.json', JSON.stringify(resp, null, 2));

// Walk the tree; report every key path whose name mentions trend, and any
// object that looks like a trend (has a name + a metadata sibling).
const paths: string[] = [];
const typenames = new Set<string>();
const walk = (o: any, p = '') => {
  if (o === null || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.slice(0, 3).forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
  if (typeof o.__typename === 'string') typenames.add(o.__typename);
  for (const [k, v] of Object.entries(o)) {
    const np = p ? `${p}.${k}` : k;
    if (/trend/i.test(k)) paths.push(`${np}  (${Array.isArray(v) ? `array[${v.length}]` : typeof v})`);
    walk(v, np);
  }
};
walk(resp);
console.log('key paths mentioning "trend":');
paths.slice(0, 12).forEach((p) => console.log('  ', p));
console.log('\n__typename values seen:', [...typenames].slice(0, 20).join(', '));
