import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ locale: 'en-US' });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const snap = async (label: string) => {
  const inputs = await page.locator('input').evaluateAll((els) =>
    els.map((e: any) => ({ name: e.name, type: e.type, testid: e.getAttribute('data-testid'), autocomplete: e.autocomplete, visible: e.offsetParent !== null }))
  );
  const buttons = await page.locator('button, [role="button"]').evaluateAll((els) =>
    els.map((e: any) => (e.textContent || '').trim()).filter(Boolean).slice(0, 8)
  );
  console.log(`\n[${label}] url=${page.url().replace('https://x.com', '')}`);
  console.log('  inputs:', JSON.stringify(inputs.filter((i: any) => i.visible)));
  console.log('  buttons:', JSON.stringify(buttons));
};

await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await snap('landing');

// identifier
await page.locator('input').first().fill(process.env.TWITTER_AUTH_INFO_1!);
const next1 = page.getByRole('button', { name: /next/i }).first();
console.log('\n"Next" button count:', await next1.count());
if (await next1.count()) await next1.click();
await page.waitForTimeout(3500);
await snap('after-identifier');

await browser.close();
