/** Exercise real API actions via cookies, paced to avoid rate limits. */
import 'dotenv/config';
import { Client } from '../src/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const client = new Client({ silent: true });
client.setCookies({
  auth_token: process.env.TWITTER_AUTH_TOKEN!,
  ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)!,
});

const step = async (name: string, fn: () => Promise<string>, gap = 5000) => {
  try { console.log(`  ✓ ${name}: ${await fn()}`); }
  catch (e) { console.log(`  ✗ ${name}: ${(e as Error).message.slice(0, 90)}`); }
  await sleep(gap);
};

console.log('paced actions via cookies (5s between calls):\n');

await step('user()', async () => { const u = await client.user(); return `@${u.screenName} (id=${u.id}, ${u.followersCount} followers)`; });
await step('getUserByScreenName("x")', async () => { const u = await client.getUserByScreenName('x'); return `@${u.screenName}, ${u.followersCount} followers`; });
await step('getTimeline(10)', async () => { const t = await client.getTimeline(10); return `${t.length} tweets, first by @${t[0]?.user?.screenName}`; });
await step('getUserTweets(self)', async () => { const me = await client.userId(); const t = await client.getUserTweets(me, 'Tweets', 5); return `${t.length} tweets`; });
await step('searchTweet("nodejs","Latest")', async () => { const t = await client.searchTweet('nodejs', 'Latest', 5); return `${t.length} results, e.g. @${t[0]?.user?.screenName}`; });
await step('search pagination', async () => { const t = await client.searchTweet('typescript', 'Latest', 5); const n = await t.next(); return `page1=${t.length}, page2=${n.length}`; });
await step('searchUser("elon")', async () => { const u = await client.searchUser('elon', 5); return `${u.length} users, e.g. @${u[0]?.screenName}`; });
await step('getTrends()', async () => { const tr = await client.getTrends('trending', 5); return `${tr.length}: ${tr.slice(0, 3).map((t) => t.name).join(', ')}`; });
await step('getTweetById (from timeline)', async () => { const tl = await client.getTimeline(5); const id = tl[0]!.id; const tw = await client.getTweetById(id); return `id=${tw.id}, ${tw.favoriteCount} likes, ${tw.replies?.length ?? 0} replies loaded`; }, 0);

console.log('\ndone.');
