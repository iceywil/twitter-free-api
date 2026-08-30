/**
 * Browser-driven login that harvests session cookies.
 *
 * Native login is not possible: x.com's `/i/jfapi/onboarding/web/*` flow
 * requires a `$castle_token`, a ~6 KB encrypted device-fingerprint blob
 * produced by the Castle.io SDK inside a real browser. It cannot be forged or
 * replayed from Node. This drives a real browser through the login form once
 * and returns the resulting cookies, after which the plain {@link Client} runs
 * the entire (ungated) API from Node with no browser.
 *
 * Playwright is an OPTIONAL peer dependency — install it only if you use this
 * module:
 *
 * ```sh
 * npm install playwright
 * npx playwright install chromium
 * ```
 */

export interface BrowserLoginOptions {
  /** Username, email, or phone number. */
  authInfo1: string;
  /** A second identifier (e.g. email when the first is a username). */
  authInfo2?: string;
  password: string;
  /** TOTP secret for 2FA, or a callback that supplies the code. */
  totpSecret?: string;
  /** Called when a verification code is needed and no `totpSecret` is set. */
  onVerificationCode?: (prompt: string) => Promise<string>;
  /** Show the browser window. Defaults to headless. */
  headed?: boolean;
  /** Use the locally installed Google Chrome instead of bundled Chromium. */
  useChrome?: boolean;
  /** Milliseconds to wait for each navigation/selector. Defaults to 30000. */
  timeout?: number;
  /** Proxy URL, forwarded to the browser. */
  proxy?: string;
}

export interface BrowserLoginResult {
  /** Session cookies, ready for {@link Client.setCookies}. */
  cookies: Record<string, string>;
  /** The `auth_token` cookie, if present. */
  authToken?: string;
  /** The `ct0` (CSRF) cookie, if present. */
  ct0?: string;
}

// Loaded lazily so the package does not hard-depend on Playwright.
type PlaywrightModule = typeof import('playwright');

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import('playwright')) as PlaywrightModule;
  } catch {
    throw new Error(
      "browserLogin requires the optional 'playwright' dependency. " +
        'Install it with: npm install playwright && npx playwright install chromium'
    );
  }
}

async function totpNow(secret: string): Promise<string> {
  const { TOTP } = await import('otpauth');
  return new TOTP({ secret }).generate();
}

/**
 * Logs in through a real browser and returns the session cookies.
 *
 * @example
 * import { browserLogin } from 'twitter-free-api/browser';
 * import { Client } from 'twitter-free-api';
 *
 * const { cookies } = await browserLogin({
 *   authInfo1: 'username',
 *   password: 'password',
 *   totpSecret: 'BASE32SECRET', // optional
 * });
 *
 * const client = new Client();
 * client.setCookies(cookies);
 * await client.saveCookies('cookies.json'); // reuse next time, no browser
 */
export async function browserLogin(options: BrowserLoginOptions): Promise<BrowserLoginResult> {
  const { chromium } = await loadPlaywright();
  const timeout = options.timeout ?? 30_000;

  const browser = await chromium.launch({
    headless: !options.headed,
    ...(options.useChrome ? { channel: 'chrome' } : {}),
    ...(options.proxy ? { proxy: { server: options.proxy } } : {}),
  });

  try {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissCookieBanner(page);

    // The current jfapi flow shows username and password on one form.
    const identifier = await firstVisible(
      page,
      ['input[name="username_or_email"]', 'input[name="text"]', 'input[autocomplete~="username"]'],
      timeout
    );
    if (!identifier) throw new Error('Username field never appeared; the login flow may have changed.');
    await identifier.fill(options.authInfo1);

    const pw = await firstVisible(page, ['input[name="password"]', 'input[type="password"]'], timeout);
    if (pw) await pw.fill(options.password);

    // x.com's login errors arrive in the onboarding action responses rather
    // than the DOM, so capture them to report something actionable.
    const actionErrors: string[] = [];
    page.on('response', async (res: any) => {
      if (!/jfapi\/onboarding\/web\/actions/.test(res.url())) return;
      const body = await res.text().catch(() => '');
      for (const m of body.matchAll(/[A-Z][^\u0000-\u001f]{15,160}?[.!]/g)) {
        const text = m[0].trim();
        if (/limit|incorrect|wrong|suspend|locked|unusual|try again|verify/i.test(text)) {
          if (!actionErrors.includes(text)) actionErrors.push(text);
        }
      }
    });

    await clickContinue(page);
    await page.waitForTimeout(2500);

    // A second identifier or password may be requested on a follow-up step
    // (older/variant flows), plus any 2FA / email challenge.
    if (!pw) {
      const pw2 = await firstVisible(page, ['input[name="password"]', 'input[type="password"]'], 6000);
      if (pw2) {
        await pw2.fill(options.password);
        await clickContinue(page);
        await page.waitForTimeout(2000);
      }
    }
    await handleChallenge(page, options);

    // Success: auth_token becomes available.
    await waitForCookie(context, 'auth_token', timeout);

    const cookies: Record<string, string> = {};
    for (const c of await context.cookies()) {
      if (c.domain.includes('x.com') || c.domain.includes('twitter.com')) cookies[c.name] = c.value;
    }

    if (!cookies.auth_token) {
      if (actionErrors.length > 0) {
        throw new Error(`x.com rejected the login: ${actionErrors.join(' | ')}`);
      }
      throw new Error(
        'Login did not yield an auth_token cookie. No error was reported, so the ' +
          'flow may have changed, or a challenge is pending — retry with `headed: true` to watch it.'
      );
    }

    return { cookies, authToken: cookies.auth_token, ct0: cookies.ct0 };
  } finally {
    await browser.close();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;
type BrowserContext = any;
type Locator = any;

/**
 * Submits the current step.
 *
 * The names are anchored deliberately: the login page also offers
 * "Continue with phone" / "Continue with Google" / "Continue with Apple", and a
 * loose /continue/i match hits one of those and derails into signup.
 */
async function clickContinue(page: Page): Promise<void> {
  // The page renders duplicate forms, one of them hidden, so pick the first
  // submit button that is actually visible rather than the first in the DOM.
  const submits = page.locator('form button[type="submit"]');
  const total = await submits.count();
  for (let i = 0; i < total; i += 1) {
    const candidate = submits.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click();
      return;
    }
  }
  for (const name of [/^continue$/i, /^log in$/i, /^next$/i]) {
    const btn = page.getByRole('button', { name }).first();
    if ((await btn.count()) && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      return;
    }
  }
}

async function dismissCookieBanner(page: Page): Promise<void> {
  for (const name of [/refuse non-essential/i, /accept all cookies/i]) {
    const btn = page.getByRole('button', { name }).first();
    if ((await btn.count()) && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function firstVisible(page: Page, selectors: string[], ms: number): Promise<Locator | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) && (await loc.isVisible().catch(() => false))) return loc;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function handleChallenge(page: Page, options: BrowserLoginOptions): Promise<void> {
  const field = await firstVisible(
    page,
    ['input[data-testid="ocfEnterTextTextInput"]', 'input[name="text"]', 'input[inputmode="numeric"]'],
    6000
  );
  if (!field) return; // no challenge

  let code: string;
  if (options.totpSecret) {
    code = await totpNow(options.totpSecret);
  } else if (options.onVerificationCode) {
    const label = (await page.locator('span, div').filter({ hasText: /code|verification/i }).first().textContent().catch(() => null)) ?? 'Enter the verification code';
    code = await options.onVerificationCode(label.trim());
  } else {
    throw new Error(
      'A verification code is required. Provide `totpSecret` or an `onVerificationCode` callback.'
    );
  }

  await field.fill(code);
  await clickContinue(page);
}

async function waitForCookie(context: BrowserContext, name: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const cookies = await context.cookies();
    if (cookies.some((c: any) => c.name === name && c.value)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}
