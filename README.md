# Free-Twitter-API

Free Twitter API for Twitter in Typescript. It authenticates the way the web app
does and speaks the same internal GraphQL and v1.1 endpoints — no developer
account, no API key, no browser at runtime.

> **Legal / ToS note.** This uses private endpoints, against X's Terms of
> Service. Automating an account risks suspension. Use a throwaway account, keep
> request volume low, and don't rely on it for anything you can't afford to lose.

## Highlights

- No API key, no browser at runtime — plain HTTP from Node
- Native login, including 2FA/TOTP, Castle device tokens and Arkose unlock
- Self-healing `x-client-transaction-id`
- Search, home and user timelines, tweet detail with replies, trends
- Guest client for read-only use with no account
- Post, delete, poll, chunked media upload, like, retweet, bookmark, follow, DM
- Full profile management — name, bio, location, URL, avatar, banner, @handle
- Cursor-based pagination on every listing
- Strict TypeScript, ESM + CJS, complete type declarations

## Install

```bash
npm install git+https://github.com/iceywil/Free-Twitter-API.git#v0.1.0
```

Node 20+. The package builds itself on install (`prepare`).

From source:

```bash
npm install && npm run build && npm test
```

## Quick start

```ts
import { Client } from 'free-twitter-api';

const client = new Client({ language: 'en-US' });

await client.login({
  authInfo1: 'your_username',
  authInfo2: 'your_email@example.com',
  password: 'your_password',
  cookiesFile: 'cookies.json', // reused on later runs, skipping the login flow
});

const me = await client.user();
console.log(`@${me.screenName}`);

const tweets = await client.searchTweet('typescript', 'Latest', 20);
for (const tweet of tweets) {
  console.log(tweet.user?.screenName, tweet.text);
}

const nextPage = await tweets.next();
```

### No account at all

The guest client reads public data using a guest token:

```ts
import { GuestClient } from 'free-twitter-api';

const client = new GuestClient();
await client.activate();

const user = await client.getUserByScreenName('jack');
const tweets = await client.getUserTweets(user.id);
```

### Posting, media, polls

```ts
const mediaIds = [
  await client.uploadMedia('image.png'),
  await client.uploadMedia('video.mp4', { waitForCompletion: true }),
];
await client.createTweet('Hello', { mediaIds });

const pollUri = await client.createPoll(['Red', 'Blue'], 60);
await client.createTweet('Pick one', { pollUri });
```

### Real-time streaming

```ts
import { Topic } from 'free-twitter-api';

const session = await client.getStreamingSession(
  new Set([Topic.tweetEngagement('1519480761749016577')])
);

for await (const [topic, payload] of session) {
  console.log(topic, payload.tweetEngagement?.likeCount);
}
```

### Pagination

Every paginated method returns a `Result<T>`, which **is** an array (index it, spread it, `for...of` it, `.map()` it) and additionally knows how to fetch adjacent pages:

```ts
const followers = await client.getUserFollowers(userId);
console.log(followers.length, followers[0].screenName);

const page2 = await followers.next();
const back = await page2.previous();
```

## Login

`client.login()` runs x.com's current native flow — no browser:

```ts
const client = new Client({ loginTimezone: 'Europe/Paris' });
await client.login({
  authInfo1: 'username',        // or email / phone
  password: 'password',
  totpSecret: 'BASE32SECRET',   // optional, for 2FA
  cookiesFile: 'cookies.json',  // reused on later runs to skip login
});
```

Login drives x.com's current native flow and mints the Castle device token by
running the real SDK in a locked-down `node:vm` sandbox — no `require`, no
`process`, no `fs`, no real network. If you would rather not run remote JS, load
exported cookies instead:

```ts
const client = new Client();
await client.loadCookies('cookies.json');   // { "auth_token": "...", "ct0": "..." }
```

A Playwright-based `browserLogin()` (optional `free-twitter-api/browser` entry point)
is also available if you prefer a real browser for the one-time cookie grab.

## Known limitations

- **Login rate-limiting is per-IP**, not per-account, so avoid rapid repeated
  login calls. It clears on its own.
- **`getTrends()` ignores `category` when it falls back.** v1.1 `guide.json` now
  answers with a cursor-only payload, so trends come from the GraphQL Explore
  endpoints, which take no category — `trending`, `news`, `sports` and
  `entertainment` return the same list. `guide.json` is still tried first.

## Configuration

```ts
new Client({
  language: 'en-US',
  proxy: 'http://user:pass@host:port',   // http, https and socks are supported
  userAgent: '...',
  timeout: 60_000,
  captchaSolver: new Capsolver({ apiKey: '...' }),
  prompt: async (message) => '123456',   // supply 2FA / email codes non-interactively
  requireTransactionId: false,
  silent: false,
});
```

Locked accounts can be unlocked automatically with [Capsolver](https://capsolver.com):

```ts
import { Capsolver, Client } from 'free-twitter-api';

const client = new Client({
  captchaSolver: new Capsolver({ apiKey: process.env.CAPSOLVER_API_KEY!, maxAttempts: 10 }),
});
```

## What's covered

- **Auth** — login (with 2FA/TOTP, email confirmation, Arkose unlock), logout, cookie save/load, delegate accounts
- **Tweets** — create (incl. long-form note tweets, polls, media, community, reply-control, edits), schedule, delete, fetch by id(s), replies and threads, like, retweet, bookmark, similar tweets, community notes
- **Timelines** — For You, Following, user tweets/replies/media/likes, highlights
- **Users** — by id or handle, follow, block, mute, followers, following, verified followers, followers-you-know, subscriptions, follower/friend id lists
- **Profile** — edit name, bio, location and URL (`updateProfile`), set profile picture (`updateProfileImage`) and banner (`updateProfileBanner` / `removeProfileBanner`), change @handle (`updateScreenName`)
- **Search** — tweets, users, lists, communities, community tweets, plus a typed `buildQuery` helper for X's search operators
- **DMs** — send, reply, delete, reactions, history, group DMs, group management
- **Lists** — create, edit, banner, members, subscribers, tweets
- **Communities** — search, join/leave/request, members, moderators, tweets, timeline
- **Bookmarks** — add, remove, folders, delete-all
- **Media** — chunked upload (parallel segments), status polling, metadata/alt text, download, video streams, HLS playlists, WebVTT subtitles
- **Trends** — trending/for-you/news/sports/entertainment, locations, per-place trends
- **Notifications** — all, verified, mentions
- **Streaming** — live sessions, subscription updates, auto-reconnect

## Examples

Runnable scripts in [`examples/`](./examples): `basic.ts`, `guest.ts`, `postTweet.ts`, `streaming.ts`.

```bash
npx tsx examples/basic.ts
```

They read `TWITTER_AUTH_INFO_1`, `TWITTER_PASSWORD` and optionally
`TWITTER_TOTP_SECRET` from the environment.

## Testing

```bash
npm test                    # unit tests, no network
npx tsx scripts/smoke.ts    # live check; runs the guest half with no credentials
```

Unit tests cover the parts most likely to drift: transaction-id maths, the
search-query builder, `Result` pagination, model field mapping, and the
hand-written m3u8 / WebVTT / media-type / ui_metrics parsers.

## License

MIT — see [LICENSE](./LICENSE).
