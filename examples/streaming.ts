/**
 * Listen for real-time engagement events on a tweet.
 *
 * Run with: npx tsx examples/streaming.ts
 */

import 'dotenv/config';
import { Client, Topic } from '../src/index.js';

const client = new Client();
await client.login({
  authInfo1: process.env.TWITTER_AUTH_INFO_1!,
  authInfo2: process.env.TWITTER_AUTH_INFO_2,
  password: process.env.TWITTER_PASSWORD!,
  cookiesFile: process.env.TWITTER_COOKIES_FILE || 'cookies.json',
});

const topics = new Set([Topic.tweetEngagement('1519480761749016577')]);
const session = await client.getStreamingSession(topics);

for await (const [topic, payload] of session) {
  if (payload.tweetEngagement) {
    console.log(topic, payload.tweetEngagement.likeCount);
  }
}
