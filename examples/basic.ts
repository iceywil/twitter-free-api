/**
 * Log in (or reuse cached cookies) and read some timelines.
 *
 * Run with: npx tsx examples/basic.ts
 */

import 'dotenv/config';
import { Client } from '../src/index.js';

const client = new Client({
  language: 'en-US',
  proxy: process.env.TWITTER_PROXY || null,
});

await client.login({
  authInfo1: process.env.TWITTER_AUTH_INFO_1!,
  authInfo2: process.env.TWITTER_AUTH_INFO_2,
  password: process.env.TWITTER_PASSWORD!,
  totpSecret: process.env.TWITTER_TOTP_SECRET || undefined,
  cookiesFile: process.env.TWITTER_COOKIES_FILE || 'cookies.json',
});

const me = await client.user();
console.log(`Logged in as @${me.screenName} (${me.followersCount} followers)`);

// A user and their tweets.
const user = await client.getUserByScreenName('jack');
console.log(`\n@${user.screenName}: ${user.description}`);

const tweets = await user.getTweets('Tweets', 5);
for (const tweet of tweets) {
  console.log(`  ${tweet.createdAt} — ${tweet.text.slice(0, 60)}`);
}

// Pagination.
const more = await tweets.next();
console.log(`\nNext page: ${more.length} tweets`);

// Search.
const results = await client.searchTweet('typescript', 'Latest', 5);
for (const tweet of results) {
  console.log(`  @${tweet.user?.screenName}: ${tweet.text.slice(0, 60)}`);
}
