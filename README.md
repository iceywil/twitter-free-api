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

- **The transaction-id header.** See below. As shipped, upstream currently fails on *every* call because of this; the port is only usable at all because it degrades.
- **Unavailable quoted/retweeted tweets.** x.com returns `quoted_status_result: {}` for a deleted quote. Upstream indexes straight into it and raises; here `tweet.quote` is simply `null`. Reproducible on real timelines (@jack's, for one).
- **The two user schemas.** x.com is migrating the user payload from a single `legacy` blob to per-concern objects (`core`, `avatar`, `profile_bio`, `relationship_counts`, `tweet_counts`, ...). Both are live at once: `UserByScreenName` still returns `legacy`, while `Viewer` returns only the new shape. Every `User` field reads `legacy` first and falls back to its new-schema location. Upstream, which assumes `legacy`, throws `KeyError: 'urls'` on the home timeline and on user tweets.
- **Empty request bodies.** httpx sends `data={}` as an empty form body with `content-type: application/x-www-form-urlencoded`; x.com answers 404. The port sends no body and leaves the content type alone. This is the difference between a working and a non-working guest client.
- **`userId()` / `user()`.** Upstream reads these from `1.1/account/settings.json`. Every v1.1 account route (`settings.json`, `verify_credentials.json`) now returns 404, so both resolve through the GraphQL `Viewer` operation, keeping the upstream path as a fallback. `user()` is built straight from the `Viewer` payload, which also sidesteps `UserByRestId` — an endpoint some networks see WAF-blocked while the rest of the GraphQL surface stays reachable.
- **`getTrends()` retries.** Upstream recurses without a bound while x.com returns an empty guide response. The port keeps retrying but caps it at `Client.MAX_TREND_ATTEMPTS` (10).

## The `x-client-transaction-id` header

x.com expects requests to carry this header. Generating it means scraping a key-byte index table and a loading-animation SVG out of the logged-out home page — markup X reshapes periodically.

**As of the last check, upstream's algorithm can no longer be run at all.** The verification key and the four `loading-x-anim` frames are still on the page, but the `ondemand.s` hash that locates the key-byte index table is absent from the HTML and from every bundle (`main`, `vendor`, `en` — 2.3 MB scanned), and the `obfiowerehiring` keyword the hash input depends on appears in none of them. That points to x.com having replaced the scheme rather than moved it, so recovering it means reverse-engineering the current signing code — a separate project from this port, against a moving target.

Rather than fail every request, this port emits one warning and continues without the header:

```
twikit-ts: could not generate the x-client-transaction-id header (...); continuing without it.
```

Most requests still work without it (the guest client, timelines, user lookups and `Viewer` all pass). The routes that do require it — `login()` and the search operations — are listed under **Known limitations**. The generator is fully ported and will start working again the moment the page exposes those inputs. To treat the failure as fatal instead:

```ts
new Client({ requireTransactionId: true });
```

Pass `silent: true` to suppress the warning.

## Known limitations

Verified against the live API. None of these are fixable in library code:

- **`login()` is blocked for non-browser clients.** `POST /1.1/onboarding/task.json` returns a Cloudflare *"Sorry, you have been blocked"* page. Reproduced identically from Node, Python/httpx and curl, on both datacenter and residential IPs, with and without browser-like headers, cookies and a transaction-id header — the block happens before the request reaches x.com's API. Use exported browser cookies instead:

  ```ts
  const client = new Client();
  await client.loadCookies('cookies.json');   // { "auth_token": "...", "ct0": "..." }
  ```

  Read endpoints are unaffected, so this path works normally.

- **`searchTweet()` / `searchUser()` / `searchList()` return an empty `404`.** Same root cause as `login()`: these routes require client attestation a plain HTTP client cannot produce. What was ruled out, by testing against the live API:

  | Ruled out | Evidence |
  | --- | --- |
  | Stale query ID | the live ID (`hyPfJYJ_XAtDYoslQc-Rgg`) 404s exactly like the shipped one, while other operations work on their shipped IDs |
  | Account gating | search works in the browser on the same account |
  | Bad `features` / params | identical 404 with the full set, no set, an empty set, and with `fieldToggles` |
  | Wrong `Referer` | no change |
  | Missing transaction-id header alone | no change with a placeholder header |

  Every variant returns a byte-identical zero-length 404 while still carrying `x-rate-limit-limit`, so the request reaches x.com and is refused at the route. A parameter error would return JSON.

  `searchTweet()` therefore falls back to the legacy `2/search/adaptive.json` route, which no twikit version uses and which is *not* gated the same way. That route returned real results once during testing, then began answering HTTP 200 with a zero-length body while reporting 893/900 rate limit remaining — so treat it as best-effort: it yields an empty `Result` rather than throwing. `searchUser()` and `searchList()` have no such fallback and still fail.

- **`getTrends()` can return an empty array.** The `guide.json` endpoint answers with a cursor-only payload indefinitely for some sessions, where the Python library on the same account and cookies gets results. Requests are byte-identical (URL, headers, cookie header), so the cause sits below the HTTP layer and is unresolved.


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
npm test                    # 70 unit tests, no network
npx tsx scripts/smoke.ts    # live check; runs the guest half with no credentials
```

The unit tests cover the parts of a port most likely to drift: the transaction-id maths (cubic bezier, hex conversion, Python's round-half-to-even), the search-query builder, `Result` pagination, model field mapping, and the hand-written m3u8 / WebVTT / media-type / ui_metrics parsers. Expected values in the transaction tests were captured from the Python original.

`scripts/smoke.ts` runs against the real API. Without credentials it exercises the guest client only; with credentials in `.env` it also checks login, search, timelines, trends and pagination.

## License

MIT — same as the original. Copyright is preserved for [d60](https://github.com/d60) (the Python library) in [LICENSE](./LICENSE). The transaction-id module derives from [TweeterPy](https://github.com/iSarabjitDhiman/TweeterPy) via upstream, and keeps its attribution.
