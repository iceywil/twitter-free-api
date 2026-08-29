import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from '../src/index.js';
import { flattenParams, findDict } from '../src/utils.js';

const features = JSON.parse(readFileSync('scripts/.explore-features.json', 'utf-8'));
const client = new Client({ silent: true });
client.setCookies({
  auth_token: process.env.TWITTER_AUTH_TOKEN!,
  ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)!,
});

for (const [name, qid, vars] of [
  ['ExploreSidebar', 'qjhLfJKwuRiKMQ6zBgkfYQ', {}],
  ['ExplorePage', 'jo4rJIWiO5pQlMk6FYphZQ', { cursor: '' }],
] as const) {
  const [resp, raw] = await client.get(`https://x.com/i/api/graphql/${qid}/${name}`, {
    params: flattenParams({ variables: vars, features }),
    headers: client.baseHeaders,
    raiseException: false,
  } as any);
  const err = (resp as any)?.errors?.[0]?.message;
  console.log(`${name}: ${raw.status} len=${raw.text.length}${err ? ' err=' + String(err).slice(0, 70) : ''}`);
  if (raw.status !== 200) continue;

  // Trend objects carry trendMetadata; find them wherever they sit.
  const trends = findDict(resp, 'trend', false).filter((t: any) => t && t.name);
  console.log(`  trend objects found: ${trends.length}`);
  trends.slice(0, 6).forEach((t: any) =>
    console.log(`    ${t.name}${t.trendMetadata?.metaDescription ? ' — ' + t.trendMetadata.metaDescription : ''}`)
  );
}
