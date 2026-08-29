/**
 * Opens a visible Chromium and records every request/response to disk.
 *
 * You drive it: log in, then run a search. Everything lands in
 * scripts/.intercept.jsonl (full headers for x.com API routes) plus
 * scripts/.storage.json (cookies), both gitignored.
 */
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const LOG = 'scripts/.intercept.jsonl';
const BODIES = 'scripts/.bodies';
mkdirSync(BODIES, { recursive: true });
writeFileSync(LOG, '');

const isApi = (u: string) =>
  /x\.com\/i\/api\/|api\.x\.com\/|\/graphql\/|onboarding|guest\/activate|js_inst|search/.test(u);

const KEY = /SearchTimeline|onboarding\/task|search\/adaptive|guest\/activate|Viewer|HomeTimeline/;

const log = (o: unknown) => appendFileSync(LOG, JSON.stringify(o) + '\n');

// Prefer the locally installed Google Chrome: no extra download, and a real
// Chrome TLS fingerprint. Falls back to Playwright's bundled Chromium.
const launchArgs = {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
};
let browser;
try {
  browser = await chromium.launch({ ...launchArgs, channel: 'chrome' });
  console.log('launched: Google Chrome');
} catch {
  browser = await chromium.launch(launchArgs);
  console.log('launched: bundled Chromium');
}
const context = await browser.newContext({
  locale: 'en-US',
  viewport: { width: 1280, height: 900 },
});

let n = 0;
context.on('request', async (req) => {
  const url = req.url();
  const entry: Record<string, unknown> = {
    t: Date.now(),
    kind: 'req',
    method: req.method(),
    url,
    resourceType: req.resourceType(),
  };
  if (isApi(url)) {
    entry.headers = await req.allHeaders().catch(() => ({}));
    const post = req.postData();
    if (post) entry.postData = post.slice(0, 20000);
  }
  log(entry);
  n += 1;
});

context.on('response', async (res) => {
  const url = res.url();
  if (!isApi(url)) {
    log({ t: Date.now(), kind: 'res', url, status: res.status() });
    return;
  }
  let len = -1;
  let body = '';
  try {
    const buf = await res.body();
    len = buf.length;
    if (KEY.test(url) && len > 0 && len < 4_000_000) body = buf.toString('utf-8');
  } catch { /* body unavailable */ }

  log({ t: Date.now(), kind: 'res', url, status: res.status(), len, headers: await res.allHeaders().catch(() => ({})) });

  if (body) {
    const name = `${Date.now()}-${url.split('?')[0].split('/').pop()}.json`;
    writeFileSync(`${BODIES}/${name}`, body);
  }
});

// Snapshot cookies periodically so the post-login state is captured.
const snap = setInterval(async () => {
  try {
    writeFileSync('scripts/.storage.json', JSON.stringify(await context.storageState(), null, 2));
  } catch { /* context gone */ }
}, 4000);

const page = await context.newPage();
await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('READY — browser open. Log in, then run a search. Recording to', LOG);

// Stay alive ~40 minutes, or until the browser is closed.
const started = Date.now();
browser.on('disconnected', () => {
  clearInterval(snap);
  console.log(`browser closed after ${Math.round((Date.now() - started) / 1000)}s, ${n} requests`);
  process.exit(0);
});
await new Promise((r) => setTimeout(r, 40 * 60 * 1000));
clearInterval(snap);
console.log(`timeout reached, ${n} requests recorded`);
await browser.close().catch(() => {});
