import 'dotenv/config';
import { Client } from '../src/index.js';
import { findDict } from '../src/utils.js';

const client = new Client({ silent: true });
client.setCookies({
  auth_token: process.env.TWITTER_AUTH_TOKEN!,
  ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)!,
});

for (const attempt of [1, 2, 3]) {
  const [resp, raw] = await client.v11.guide('trending', 20, null);
  const all = findDict(resp, 'entries', true)[0] ?? [];
  const ids = all.map((e: any) => String(e.entryId));
  console.log(
    `attempt ${attempt}: status=${raw.status} len=${raw.text.length} entries=${all.length}` +
      ` tid=${raw.headers['x-transaction-id'] ? 'server-ack' : '-'}`
  );
  console.log('   entryIds:', ids.slice(0, 6).join(', ') || '(none)');
  if (all.length > 2) {
    const trendEntry = all.find((e: any) => String(e.entryId).startsWith('trends'));
    console.log('   trends entry present:', !!trendEntry);
    if (trendEntry) {
      const items = trendEntry.content?.timelineModule?.items ?? [];
      console.log('   items:', items.length);
      break;
    }
  }
}
