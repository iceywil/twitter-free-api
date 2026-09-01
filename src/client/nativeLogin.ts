/**
 * Native login against x.com's current `/i/jfapi/onboarding/web/actions/*`
 * flow — no browser.
 *
 * x.com retired `1.1/onboarding/task.json`, the flow older clients drive. The
 * live flow is: `begin_login` (username + Castle token) → `login_enter_password`
 * (username + password + session token + Castle token), with optional 2FA. Each
 * request needs a valid `x-client-transaction-id` and a Castle device token,
 * both of which this library now generates natively.
 *
 * Verified: a natively-minted Castle token is accepted by `begin_login`
 * (the request reaches username validation). See {@link CastleSolver}.
 */

import * as cheerio from 'cheerio';
import { TOKEN } from '../constants.js';
import { AccountLocked, TwitterException, TooManyRequests } from '../errors.js';
import { CastleSolver } from '../internal/castleSolver.js';
import type { HttpSession } from '../internal/http.js';
import { resolveOndemandCastleUrl } from '../transaction/utils.js';

const JF_VERSION = 'JP-5';

export interface NativeLoginParams {
  authInfo1: string;
  authInfo2?: string;
  password: string;
  totpSecret?: string;
  timezone?: string;
  userAgent: string;
  guestToken: string;
  /** Generates an `x-client-transaction-id` for a method + path. */
  transactionId: (method: string, path: string) => string | Promise<string>;
  /** Supplies a verification/2FA code when x.com asks and no TOTP secret is set. */
  prompt: (message: string) => Promise<string>;
}

/** Extracts printable ASCII runs from a length-delimited jfapi response body. */
function readableStrings(body: string): string[] {
  return [...body.matchAll(/[\x20-\x7e]{4,}/g)].map((m) => m[0]);
}

function findError(strings: string[]): string | null {
  const joined = strings.join(' ');
  const patterns = [
    /We(?:'|’)?ve temporarily limited your login[^"]*/i,
    /couldn(?:'|’)?t find an active X account[^"]*/i,
    /(?:incorrect|wrong) (?:password|username)[^"]*/i,
    /your account is suspended[^"]*/i,
  ];
  for (const p of patterns) {
    const m = p.exec(joined);
    if (m) return m[0];
  }
  return null;
}

/** The 36-char onboarding session token returned by `begin_login`. */
function findSessionToken(strings: string[]): string | null {
  return (
    strings.find((s) => /^[A-Za-z0-9_-]{36}$/.test(s)) ??
    strings.find((s) => s.length >= 30 && s.length <= 48 && /^[A-Za-z0-9_-]+$/.test(s)) ??
    null
  );
}

export class NativeLoginFlow {
  private readonly castle: CastleSolver;

  private constructor(
    private readonly session: HttpSession,
    private readonly params: NativeLoginParams,
    sdkSource: string,
    pk: string
  ) {
    this.castle = new CastleSolver(sdkSource, pk, {
      userAgent: params.userAgent,
      timezone: params.timezone,
    });
  }

  /**
   * Prepares a login flow: reads the Castle publishable key from the login
   * shell and fetches the Castle SDK, both natively.
   */
  static async create(
    session: HttpSession,
    params: NativeLoginParams
  ): Promise<NativeLoginFlow> {
    const shell = await session.request('GET', 'https://x.com/i/flow/login', {
      headers: { 'User-Agent': params.userAgent, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const html = shell.text;

    const pk = /"responsive_web_castle_public_key"\s*:\s*\{[^}]*?"value"\s*:\s*"([^"]+)"/.exec(html)?.[1];
    if (!pk) {
      throw new TwitterException('Could not read the Castle publishable key from the login page.');
    }

    const castleUrl = resolveOndemandCastleUrl(html);
    if (!castleUrl) {
      throw new TwitterException('Could not locate the Castle SDK bundle (ondemand.castle).');
    }
    const sdk = await session.request('GET', castleUrl, {
      headers: { 'User-Agent': params.userAgent },
    });
    if (sdk.status !== 200) {
      throw new TwitterException(`Failed to fetch the Castle SDK (status ${sdk.status}).`);
    }

    return new NativeLoginFlow(session, params, sdk.text, pk);
  }

  private async jfHeaders(path: string): Promise<Record<string, string>> {
    return {
      accept: '*/*',
      'accept-language': 'en',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://x.com',
      referer: 'https://x.com/i/jf/onboarding/web?mode=login',
      'User-Agent': this.params.userAgent,
      'x-client-transaction-id': await this.params.transactionId('POST', path),
      'x-guest-token': this.params.guestToken,
      'x-jf-client-theme': 'light',
      'x-jf-v': JF_VERSION,
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      ...(this.params.timezone ? { timezone: this.params.timezone } : {}),
    };
  }

  private async post(path: string, fields: [string, string][]): Promise<string[]> {
    const body = new URLSearchParams();
    for (const [k, v] of fields) body.append(k, v);

    const res = await this.session.request('POST', `https://x.com${path}`, {
      headers: await this.jfHeaders(path),
      data: body.toString(),
    });

    const strings = readableStrings(res.text);
    const error = findError(strings);
    if (error) {
      if (/temporarily limited/i.test(error)) throw new TooManyRequests(error);
      if (/suspended/i.test(error)) throw new AccountLocked(error);
      throw new TwitterException(error);
    }
    if (res.status >= 400) {
      throw new TwitterException(`${path} failed with status ${res.status}`);
    }
    return strings;
  }

  /** Runs the flow and returns the session cookies on success. */
  async run(): Promise<Record<string, string>> {
    // Step 1: begin_login.
    const begin = await this.post('/i/jfapi/onboarding/web/actions/begin_login', [
      ['username_or_email', this.params.authInfo1],
      ['$castle_token', await this.castle.createRequestToken()],
    ]);

    const sessionToken = findSessionToken(begin);
    if (!sessionToken) {
      throw new TwitterException('begin_login did not return a session token.');
    }

    // Step 2: login_enter_password.
    const afterPassword = await this.post('/i/jfapi/onboarding/web/actions/login_enter_password', [
      ['username', this.params.authInfo1],
      ['password', this.params.password],
      ['session_token', sessionToken],
      ['$castle_token', await this.castle.createRequestToken()],
    ]);

    // Step 3: 2FA / verification challenge, if x.com asked for one. The
    // response text mentions a code entry when a challenge is pending.
    if (/two.?factor|verification|enter.*code|challenge/i.test(afterPassword.join(' '))) {
      const code = this.params.totpSecret
        ? await totpNow(this.params.totpSecret)
        : await this.params.prompt('Enter your verification code');
      await this.post('/i/jfapi/onboarding/web/actions/login_two_factor_auth_challenge', [
        ['session_token', sessionToken],
        ['code', code],
        ['$castle_token', await this.castle.createRequestToken()],
      ]);
    }

    const cookies = this.session.getCookies();
    if (!cookies.auth_token) {
      throw new TwitterException(
        'Login completed without an auth_token cookie; a challenge may be pending.'
      );
    }
    return cookies;
  }
}

async function totpNow(secret: string): Promise<string> {
  const { TOTP } = await import('otpauth');
  return new TOTP({ secret }).generate();
}

export { cheerio };
