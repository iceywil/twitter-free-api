/** Ported from twikit/x_client_transaction/utils.py */

import * as cheerio from 'cheerio';

export type CheerioRoot = cheerio.CheerioAPI;

/** Minimal HTTP surface the transaction generator needs from the client's session. */
export interface TransactionSession {
  request(
    method: string,
    url: string,
    options?: { headers?: Record<string, string>; data?: Record<string, string> }
  ): Promise<{ text: string }>;
}

const MIGRATION_REDIRECTION_REGEX =
  /(http(?:s)?:\/\/(?:www\.)?(twitter|x){1}\.com(\/x)?\/migrate([/?])?tok=[a-zA-Z0-9%\-_]+)+/;

/**
 * Follows x.com's twitter.com -> x.com migration hand-off and returns the parsed
 * home page, which carries the verification key the transaction id is derived from.
 */
export async function handleXMigration(
  session: TransactionSession,
  headers: Record<string, string>
): Promise<CheerioRoot> {
  let response = await session.request('GET', 'https://x.com', { headers });
  let homePage = cheerio.load(response.text);

  const migrationUrl = homePage("meta[http-equiv='refresh']");
  const migrationRedirectionUrl =
    MIGRATION_REDIRECTION_REGEX.exec(migrationUrl.length ? (homePage.html(migrationUrl) ?? '') : '') ??
    MIGRATION_REDIRECTION_REGEX.exec(response.text);

  if (migrationRedirectionUrl) {
    response = await session.request('GET', migrationRedirectionUrl[0], { headers });
    homePage = cheerio.load(response.text);
  }

  let migrationForm = homePage("form[name='f']");
  if (!migrationForm.length) {
    migrationForm = homePage("form[action='https://x.com/x/migrate']");
  }

  if (migrationForm.length) {
    const url = (migrationForm.attr('action') ?? 'https://x.com/x/migrate') + '/?mx=2';
    const method = migrationForm.attr('method') ?? 'POST';
    const data: Record<string, string> = {};
    migrationForm.find('input').each((_, input) => {
      const name = homePage(input).attr('name');
      if (name !== undefined) data[name] = homePage(input).attr('value') ?? '';
    });
    response = await session.request(method, url, { data, headers });
    homePage = cheerio.load(response.text);
  }

  return homePage;
}

/**
 * Replicates the upstream float -> hex conversion, including its use of
 * truncation (Python's `int()`) rather than rounding.
 */
export function floatToHex(value: number): string {
  const result: string[] = [];
  let x = value;
  let quotient = Math.trunc(x);
  const fraction = x - quotient;

  while (quotient > 0) {
    quotient = Math.trunc(x / 16);
    const remainder = Math.trunc(x - quotient * 16);
    result.unshift(remainder > 9 ? String.fromCharCode(remainder + 55) : String(remainder));
    x = quotient;
  }

  if (fraction === 0) {
    return result.join('');
  }

  result.push('.');

  let frac = fraction;
  while (frac > 0) {
    frac *= 16;
    const integer = Math.trunc(frac);
    frac -= integer;
    result.push(integer > 9 ? String.fromCharCode(integer + 55) : String(integer));
  }

  return result.join('');
}

export function isOdd(num: number): number {
  return num % 2 !== 0 ? -1.0 : 0.0;
}

export function base64Encode(data: Uint8Array | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
  return buffer.toString('base64');
}

/**
 * Python's `round()` breaks ties to even, unlike JavaScript's `Math.round()`,
 * which breaks them upward. The transaction id is a hash input, so a single
 * differing digit invalidates the whole header — round the same way Python does.
 */
export function pyRound(value: number, digits = 0): number {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;

  let rounded: number;
  if (diff > 0.5) {
    rounded = floor + 1;
  } else if (diff < 0.5) {
    rounded = floor;
  } else {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  }
  return digits === 0 ? rounded : rounded / scale;
}
