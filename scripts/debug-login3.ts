import 'dotenv/config';
import { chromium } from 'playwright';

const headless = process.env.HEADED !== '1';
const browser = await chromium.launch({ headless, channel: 'chrome' });
const context = await browser.newContext({ locale: 'en-US' });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const posts: string[] = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!/jfapi\/onboarding\/web\/actions|jfapi\/onboarding\/web$/.test(u)) return;
  let body = '';
  try { body = (await r.text()).slice(0, 260); } catch {}
  posts.push(`${r.request().method()} ${r.status()} ${u.replace('https://x.com', '').split('?')[0]}\n      ${body.replace(/\s+/g, ' ')}`);
});

await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
for (const n of [/refuse non-essential/i, /accept all cookies/i]) {
  const b = page.getByRole('button', { name: n }).first();
  if (await b.count() && await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
}
await page.waitForTimeout(800);

await page.locator('input[name="username_or_email"]').first().fill(process.env.TWITTER_AUTH_INFO_1!);
const pw = page.locator('input[name="password"]').first();
if (await pw.count()) await pw.fill(process.env.TWITTER_PASSWORD!);

const submits = page.locator('form button[type="submit"]');
const total = await submits.count();
let clicked = false;
for (let i = 0; i < total; i++) {
  const c = submits.nth(i);
  if (await c.isVisible().catch(() => false)) {
    console.log(`headless=${headless} clicking submit[${i}]:`, (await c.textContent())?.trim());
    await c.click(); clicked = true; break;
  }
}
if (!clicked) console.log('no visible submit found; total=', total);
await page.waitForTimeout(6000);

console.log('\nurl:', page.url().replace('https://x.com', ''));
console.log('onboarding action calls:');
posts.forEach((p) => console.log('   ', p));
console.log('\nvisible inputs:', JSON.stringify(await page.locator('input').evaluateAll((els) => els.filter((e: any) => e.offsetParent !== null).map((e: any) => e.name || e.type))));
const body = (await page.locator('body').textContent().catch(() => '')) ?? '';
const hints = ['incorrect', 'wrong', 'suspicious', 'verify', 'code', 'unusual', 'try again', 'locked'];
console.log('page hints:', hints.filter((h) => new RegExp(h, 'i').test(body)));
console.log('cookies:', (await context.cookies()).map((c) => c.name).join(', '));
await browser.close();
