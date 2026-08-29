/**
 * Read public data with no account at all.
 *
 * Run with: npx tsx examples/guest.ts
 */

import { GuestClient } from '../src/index.js';

const client = new GuestClient();
await client.activate();

const user = await client.getUserByScreenName('jack');
console.log(`@${user.screenName} — ${user.followersCount} followers`);

for (const tweet of await user.getTweets('Tweets', 5)) {
  console.log(`  ${tweet.text.slice(0, 70)}`);
}
