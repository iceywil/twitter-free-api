import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const AUTH = process.env.TWITTER_AUTH_TOKEN!;
const CT0 = (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)!;
const SECRET = /cookie|authorization|csrf|transaction/i;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'en-US' });

await context.addCookies([
  { name: 'auth_token', value: AUTH, domain: '.x.com', path: '/', httpOnly: true, secure: true },
  { name: 'ct0', value: CT0, domain: '.x.com', path: '/', secure: true },
]);

const captured: any[] = [];
const page = await context.newPage();

page.on('response', async (res) => {
  const url = res.url();
  if (!/SearchTimeline|search\/adaptive/.test(url)) return;
  const req = res.request();
  let len = -1;
  try {
    len = (await res.body()).length;
  } catch {
    /* body unavailable */
  }
  captured.push({ url, status: res.status(), len, headers: await req.allHeaders() });
});

await page.goto('https://x.com/search?q=typescript&src=typed_query&f=live', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForTimeout(9000);

console.log('logged in as:', await page.evaluate(() => document.title));
console.log('search requests captured:', captured.length);

for (const c of captured) {
  console.log(`\n  ${c.status} len=${c.len}  ${c.url.split('?')[0].replace('https://x.com', '')}`);
  const qid = c.url.match(/graphql\/([\w-]+)\//)?.[1];
  if (qid) console.log(`  queryId: ${qid}`);
  console.log('  headers:');
  for (const [k, v] of Object.entries<string>(c.headers)) {
    console.log(`    ${k}: ${SECRET.test(k) ? `<${v.length} chars>` : v}`);
  }
}

const cookies = await context.cookies();
console.log('\n  browser cookie names:', cookies.map((c) => c.name).join(', '));

// Persist the full capture (secrets included) for the replay step, locally only.
writeFileSync(
  'scripts/.capture.json',
  JSON.stringify({ captured, cookies }, null, 2),
  'utf-8'
);
console.log('  saved -> scripts/.capture.json');

await browser.close();
