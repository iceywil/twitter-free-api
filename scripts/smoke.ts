/**
 * Live smoke test.
 *
 * Runs the guest client (no credentials needed), then the authenticated client
 * if login details are present in the environment.
 *
 *   npx tsx scripts/smoke.ts
 */

import { existsSync } from 'node:fs';
import 'dotenv/config';
import { Client, GuestClient } from '../src/index.js';

const screenName = process.env.TEST_SCREEN_NAME || 'jack';
let failures = 0;

const check = async (name: string, fn: () => Promise<string>): Promise<void> => {
  try {
    console.log(`  ✓ ${name}: ${await fn()}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}: ${(error as Error).message.slice(0, 300)}`);
  }
};

console.log('\n== Guest client (no login) ==');
const guest = new GuestClient({ proxy: process.env.TWITTER_PROXY || null });

await check('activate()', async () => `guest token acquired (${(await guest.activate()).slice(0, 8)}…)`);
await check('getUserByScreenName()', async () => {
  const user = await guest.getUserByScreenName(screenName);
  return `@${user.screenName} — ${user.followersCount} followers, id=${user.id}`;
});
await check('getUserTweets()', async () => {
  const user = await guest.getUserByScreenName(screenName);
  const tweets = await guest.getUserTweets(user.id, 'Tweets', 5);
  return `${tweets.length} tweets, first: "${tweets[0]?.text.slice(0, 50)}…"`;
});

if (!process.env.TWITTER_AUTH_INFO_1 || !process.env.TWITTER_PASSWORD) {
  console.log('\n== Authenticated client: SKIPPED (no credentials in env) ==');
  process.exit(failures > 0 ? 1 : 0);
}

const cookiesFile = process.env.TWITTER_COOKIES_FILE || 'cookies.json';
const authToken = process.env.TWITTER_AUTH_TOKEN;
// Accept the misspelled variant too, so a typo in .env is not a silent failure.
const ct0 = process.env.TWITTER_CT0 || process.env.TWTTER_CT0;

const haveEnvCookies = Boolean(authToken && ct0);
const haveCookieFile = existsSync(cookiesFile);

console.log('\n== Authenticated client ==');
console.log(
  haveEnvCookies
    ? '  (using auth_token + ct0 from the environment, skipping the login flow)'
    : haveCookieFile
      ? `  (using cookies from ${cookiesFile}, skipping the login flow)`
      : '  (no cookies found, running the full login flow)'
);

const client = new Client({ proxy: process.env.TWITTER_PROXY || null });

const authLabel = haveEnvCookies
  ? 'setCookies()'
  : haveCookieFile
    ? 'loadCookies()'
    : 'login()';

await check(authLabel, async () => {
  if (haveEnvCookies) {
    client.setCookies({ auth_token: authToken!, ct0: ct0! });
    return `set ${Object.keys(client.getCookies()).length} cookies`;
  }
  if (haveCookieFile) {
    await client.loadCookies(cookiesFile);
    return `loaded ${Object.keys(client.getCookies()).length} cookies`;
  }
  await client.login({
    authInfo1: process.env.TWITTER_AUTH_INFO_1!,
    authInfo2: process.env.TWITTER_AUTH_INFO_2,
    password: process.env.TWITTER_PASSWORD!,
    totpSecret: process.env.TWITTER_TOTP_SECRET || undefined,
    cookiesFile,
  });
  return 'ok';
});
await check('user()', async () => {
  const me = await client.user();
  return `@${me.screenName} (id=${me.id})`;
});
await check('searchTweet()', async () => {
  const tweets = await client.searchTweet('typescript', 'Latest', 5);
  // An empty result is not a pass: x.com answers the search routes with an
  // empty payload for clients it will not serve, without raising.
  if (tweets.length === 0) throw new Error('returned 0 results (empty payload, not an error)');
  return `${tweets.length} results`;
});
await check('getTimeline()', async () => `${(await client.getTimeline(5)).length} tweets`);
await check('getUserTweets()', async () => {
  const user = await client.getUserByScreenName(screenName);
  return `${(await client.getUserTweets(user.id, 'Tweets', 5)).length} tweets`;
});
await check('getTrends()', async () => {
  const trends = await client.getTrends('trending', 5);
  if (trends.length === 0) throw new Error('returned 0 trends (empty guide response)');
  return `${trends.length}: ` + trends.map((t) => t.name).slice(0, 3).join(', ');
});
await check('pagination (Result.next)', async () => {
  const tweets = await client.searchTweet('news', 'Latest', 5);
  if (tweets.length === 0) throw new Error('search returned 0 results, cannot test pagination');
  return `${(await tweets.next()).length} on page 2`;
});

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures > 0 ? 1 : 0);
