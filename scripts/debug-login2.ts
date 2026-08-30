import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ locale: 'en-US' });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const responses: string[] = [];
page.on('response', (r) => {
  if (/onboarding|login|jfapi/.test(r.url())) responses.push(`${r.status()} ${r.url().replace('https://x.com', '').split('?')[0]}`);
});

await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// dismiss cookie banner
for (const n of [/refuse non-essential/i, /accept all cookies/i]) {
  const b = page.getByRole('button', { name: n }).first();
  if (await b.count() && await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
}
await page.waitForTimeout(800);

await page.locator('input[name="username_or_email"]').first().fill(process.env.TWITTER_AUTH_INFO_1!);
const pw = page.locator('input[name="password"]').first();
if (await pw.count()) await pw.fill(process.env.TWITTER_PASSWORD!);
console.log('filled username + password');

// what continue-like buttons exist and are they enabled?
const btns = await page.locator('button, [role="button"]').evaluateAll((els) =>
  els.filter((e: any) => e.offsetParent !== null).map((e: any) => ({ text: (e.textContent || '').trim().slice(0, 30), disabled: e.disabled }))
);
console.log('visible buttons:', JSON.stringify(btns.filter((b: any) => b.text)));

const cont = page.getByRole('button', { name: /continue|log in/i }).first();
console.log('continue count:', await cont.count());
await cont.click();
await page.waitForTimeout(4000);

console.log('url now:', page.url().replace('https://x.com', ''));
console.log('onboarding responses:', responses);
const remaining = await page.locator('input').evaluateAll((els) => els.filter((e: any) => e.offsetParent !== null).map((e: any) => e.name || e.type));
console.log('visible inputs after submit:', JSON.stringify(remaining));
const errText = await page.locator('[role="alert"], [data-testid*="error"]').allTextContents().catch(() => []);
console.log('error text:', errText);
const cookies = (await context.cookies()).map((c) => c.name);
console.log('cookies:', cookies.join(', '));
await browser.close();
