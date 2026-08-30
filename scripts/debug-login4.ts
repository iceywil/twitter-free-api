import 'dotenv/config';
import { chromium } from 'playwright';

const HEADED = process.env.HEADED === '1';

async function fillVisible(page: any, selector: string, value: string): Promise<boolean> {
  const loc = page.locator(selector);
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const c = loc.nth(i);
    if (await c.isVisible().catch(() => false)) {
      await c.fill(value);
      return true;
    }
  }
  return false;
}

const browser = await chromium.launch({ headless: !HEADED, channel: 'chrome' });
const context = await browser.newContext({ locale: 'en-US' });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const actions: string[] = [];
page.on('response', async (r) => {
  if (!/jfapi\/onboarding\/web\/actions/.test(r.url())) return;
  let b = '';
  try { b = (await r.text()).slice(0, 200); } catch {}
  actions.push(`${r.request().method()} ${r.status()} ${r.url().split('/').pop()?.split('?')[0]} :: ${b.replace(/\s+/g, ' ')}`);
});

await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
for (const nm of [/refuse non-essential/i, /accept all cookies/i]) {
  const b = page.getByRole('button', { name: nm }).first();
  if (await b.count() && await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
}
await page.waitForTimeout(1000);

const okUser = await fillVisible(page, 'input[name="username_or_email"]', process.env.TWITTER_AUTH_INFO_1!);
const okPass = await fillVisible(page, 'input[name="password"]', process.env.TWITTER_PASSWORD!);
console.log(`headed=${HEADED} filled username=${okUser} password=${okPass}`);

const submits = page.locator('form button[type="submit"]');
for (let i = 0; i < (await submits.count()); i++) {
  const c = submits.nth(i);
  if (await c.isVisible().catch(() => false)) { await c.click(); break; }
}
await page.waitForTimeout(8000);

console.log('url:', page.url().replace('https://x.com', ''));
console.log('action calls:', actions.length ? actions : '(none fired)');
const names = (await context.cookies()).map((c) => c.name);
console.log('auth_token present:', names.includes('auth_token'), '| cookies:', names.join(', '));
await browser.close();
