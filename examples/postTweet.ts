/**
 * Post a tweet with media, then delete it.
 *
 * Run with: npx tsx examples/postTweet.ts
 */

import 'dotenv/config';
import { Client } from '../src/index.js';

const client = new Client();
await client.login({
  authInfo1: process.env.TWITTER_AUTH_INFO_1!,
  authInfo2: process.env.TWITTER_AUTH_INFO_2,
  password: process.env.TWITTER_PASSWORD!,
  cookiesFile: process.env.TWITTER_COOKIES_FILE || 'cookies.json',
});

// Text only.
const tweet = await client.createTweet('Hello from twitter-free-api');
console.log('posted', tweet?.id);

// With media.
// const mediaIds = [
//   await client.uploadMedia('image.png'),
//   await client.uploadMedia('video.mp4', { waitForCompletion: true }),
// ];
// await client.createTweet('With media', { mediaIds });

// With a poll.
// const pollUri = await client.createPoll(['Red', 'Blue'], 60);
// await client.createTweet('Pick one', { pollUri });

if (tweet) await tweet.delete();
console.log('deleted');
