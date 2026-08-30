# twikit-ts

A TypeScript port of [**twikit**](https://github.com/d60/twikit) — a Twitter/X API wrapper that needs **no API key**. It logs in the way a browser does and talks to the same internal GraphQL and v1.1 endpoints the web app uses.

All ~130 client methods, all 12 data models, the login flow, media uploads, real-time streaming, the guest client, and the `x-client-transaction-id` generator are ported. Written in strict TypeScript, shipped as ESM + CJS with full type declarations.

> **Legal / ToS note.** This talks to private endpoints, which is against X's Terms of Service. Automating an account risks suspension. Use a throwaway account, keep request volume low, and don't use it for anything you can't afford to lose.

## Install

```bash
npm install twikit-ts
```

Node 20+. From source:

```bash
npm install && npm run build && npm test
```

## Quick start

```ts
import { Client } from 'twikit-ts';

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
import { GuestClient } from 'twikit-ts';

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
import { Topic } from 'twikit-ts';

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

## Differences from the Python library

The API is the same shape; the naming follows TypeScript conventions.

| Python | twikit-ts |
| --- | --- |
| `snake_case` methods and attributes | `camelCase` (`get_user_by_id` → `getUserById`, `tweet.favorite_count` → `tweet.favoriteCount`) |
| keyword arguments | a trailing options object (`client.login({ authInfo1, password })`) |
| `List` model | `TwitterList` (also exported as `List`) — avoids colliding with `Array` conventions |
| `Result` (custom sequence) | `Result<T> extends Array<T>` |
| `__eq__` | `.equals(other)` |
| `__repr__` | `.toString()` |
| `await tweet.update()` mutates in place | returns a **new** instance (`const fresh = await tweet.update()`) |
| `input()` prompts for 2FA / email codes | reads stdin by default; override with the `prompt` option |
| exceptions from `errors.py` | same names, all extending `TwitterException` |

Dependency substitutions: `httpx` → `axios` + `tough-cookie` (redirects and status-code handling deliberately match httpx), `beautifulsoup4`/`lxml` → `cheerio`, `pyotp` → `otpauth`, `Js2Py` → Node's built-in `node:vm`, and `filetype`, `m3u8` and `webvtt-py` → small purpose-built parsers with no extra dependencies.

### Deliberate fixes

Places where following upstream exactly would break at runtime. Each was found by running both libraries side by side against the live API.

- **Locating `ondemand.s`.** Upstream cannot find it any more and so throws on *every* request; this port resolves it through webpack's chunk manifests. See **The `x-client-transaction-id` header**.
- **Unavailable quoted/retweeted tweets.** x.com returns `quoted_status_result: {}` for a deleted quote. Upstream indexes straight into it and raises; here `tweet.quote` is simply `null`. Reproducible on real timelines (@jack's, for one).
- **The two user schemas.** x.com is migrating the user payload from a single `legacy` blob to per-concern objects (`core`, `avatar`, `profile_bio`, `relationship_counts`, `tweet_counts`, ...). Both are live at once: `UserByScreenName` still returns `legacy`, while `Viewer` returns only the new shape. Every `User` field reads `legacy` first and falls back to its new-schema location. Upstream, which assumes `legacy`, throws `KeyError: 'urls'` on the home timeline and on user tweets.
- **Empty request bodies.** httpx sends `data={}` as an empty form body with `content-type: application/x-www-form-urlencoded`; x.com answers 404. The port sends no body and leaves the content type alone. This is the difference between a working and a non-working guest client.
- **`userId()` / `user()`.** Upstream reads these from `1.1/account/settings.json`. Every v1.1 account route (`settings.json`, `verify_credentials.json`) now returns 404, so both resolve through the GraphQL `Viewer` operation, keeping the upstream path as a fallback. `user()` is built straight from the `Viewer` payload, which also sidesteps `UserByRestId` — an endpoint some networks see WAF-blocked while the rest of the GraphQL surface stays reachable.
- **`getTrends()` sources and retries.** Upstream recurses without a bound while x.com returns an empty guide response; the port caps that at `Client.MAX_TREND_ATTEMPTS` (10) and then falls back to the GraphQL Explore endpoints the web client uses, since `guide.json` no longer returns trends at all. `Trend` accepts both payload shapes — camelCase from `guide.json`, snake_case `TimelineTrend` from Explore.

## The `x-client-transaction-id` header

x.com requires this header on many routes — the login flow, search, and the v1.1
account endpoints among them. Without it those return an empty `404`; with it
they return normal responses. This port generates it natively, no browser
involved.

The algorithm is twikit's, and it was never wrong. The one part that had broken
was *locating* `ondemand.s`, the bundle holding the key-byte index table.
Upstream scans the page for an inline `'ondemand.s':'<hash>'` literal, which
x.com no longer emits — so upstream throws `Couldn't get KEY_BYTE indices` on
every single request. The mapping now lives in webpack's two chunk manifests:
chunk id to chunk name (inside the `r.u` filename builder) and chunk id to
contenthash. `resolveOndemandFileUrl()` reads both, still trying the legacy
literal first.

One further wrinkle: the bare landing page serves a trimmed shell with no
manifests at all. `ClientTransaction.init()` therefore walks `SHELL_PAGES`
(`/home`, `/login`, `/i/flow/login`) until it finds a page it can resolve the
table from — `/login` works unauthenticated, `/home` once cookies are set.

Verified against the live API: `account/settings.json` and `SearchTimeline` both
return 200 from plain Node, and `searchTweet()` returns results with working
pagination.

If generation ever fails again, the client emits one warning and continues
without the header rather than failing every request. Pass
`requireTransactionId: true` to treat it as fatal, or `silent: true` to mute the
warning.

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

x.com retired `1.1/onboarding/task.json` (what upstream drives). The live flow
is `/i/jfapi/onboarding/web/actions/begin_login` then `login_enter_password`,
and each POST carries a `$castle_token` from the Castle.io device-signals SDK.
That SDK is configured with a *publishable* key (`pk_…`, read live from the
login page), so nothing secret signs the token — it is produced entirely by
public client JS. The library fetches that SDK (`ondemand.castle`, resolved
through the same webpack manifests as `ondemand.s`) and runs it under `node:vm`
in a locked-down sandbox to mint a genuine token. A token minted this way was
verified accepted by `begin_login`: the request passed Castle's device check and
advanced to username validation.

**Security note.** This executes x.com's own SDK in a `node:vm` context whose
global has no `require`, `process`, `fs`, or real network — only a
self-resolving XHR stub. The SDK exposes just `configure` and
`createRequestToken`. If you would rather not run remote JS, use exported
cookies instead:

```ts
const client = new Client();
await client.loadCookies('cookies.json');   // { "auth_token": "...", "ct0": "..." }
```

A Playwright-based `browserLogin()` (optional `twikit-ts/browser` entry point)
is also available if you prefer a real browser for the one-time cookie grab.

## Known limitations

- **Login rate-limiting is per-IP.** `begin_login` throttles by IP across
  attempts (`"We've temporarily limited your login. Please try again later."`),
  independent of the account, so avoid rapid repeated login calls. Once
  throttled the limit clears on its own after a while.

- **`getTrends()` ignores `category` when it falls back.** v1.1 `guide.json`,
  which upstream uses, now answers with a cursor-only payload — verified
  identically from this port and from the Python library (0 of 15 attempts
  returned trends on the same account and cookies), so it is an endpoint
  change, not a client bug. The web client reads trends from the GraphQL
  `ExplorePage` / `ExploreSidebar` endpoints instead, and `getTrends()` falls
  back to those. Those endpoints take no category argument, so `trending`,
  `news`, `sports` and `entertainment` all return the same list once the
  fallback is in use. The `guide.json` path is still tried first, so category
  filtering returns if x.com starts serving it again.

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
import { Capsolver, Client } from 'twikit-ts';

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
cp .env.example .env   # fill in credentials
npx tsx examples/basic.ts
```

## Testing

```bash
npm test                    # 75 unit tests, no network
npx tsx scripts/smoke.ts    # live check; runs the guest half with no credentials
```

The unit tests cover the parts of a port most likely to drift: the transaction-id maths (cubic bezier, hex conversion, Python's round-half-to-even), the search-query builder, `Result` pagination, model field mapping, and the hand-written m3u8 / WebVTT / media-type / ui_metrics parsers. Expected values in the transaction tests were captured from the Python original.

`scripts/smoke.ts` runs against the real API. Without credentials it exercises the guest client only; with credentials in `.env` it also checks login, search, timelines, trends and pagination.

## License

MIT — same as the original. Copyright is preserved for [d60](https://github.com/d60) (the Python library) in [LICENSE](./LICENSE). The transaction-id module derives from [TweeterPy](https://github.com/iSarabjitDhiman/TweeterPy) via upstream, and keeps its attribution.
