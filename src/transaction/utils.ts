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

/** Pages that serve the full app shell, which carries the chunk manifests. */
export const SHELL_PAGES = [
  'https://x.com/home',
  'https://x.com/login',
  'https://x.com/i/flow/login',
] as const;

/** Returns the first balanced `{...}` literal at or after `from`. */
function firstObjectLiteral(source: string, from: number): string {
  const start = source.indexOf('{', from);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

/**
 * Locates the `ondemand.s` bundle, which holds the key-byte index table.
 *
 * Upstream looks for an inline `'ondemand.s':'<hash>'` literal. x.com no longer
 * emits that; the mapping now lives in webpack's two chunk manifests — chunk id
 * to chunk name (inside the `r.u` filename builder) and chunk id to
 * contenthash. The legacy form is still tried first so older deployments keep
 * working.
 */
export function resolveOndemandFileUrl(html: string): string | null {
  const base = 'https://abs.twimg.com/responsive-web/client-web/ondemand.s';

  const legacy = /['"]{1}ondemand\.s['"]{1}:\s*['"]{1}([\w]*)['"]{1}/.exec(html);
  if (legacy) return `${base}.${legacy[1]}a.js`;

  return resolveChunkUrl(html, 'ondemand.s');
}

/**
 * Resolves the URL of a named webpack chunk from the two manifests embedded in
 * the app shell: chunk id -> name (the `r.u` filename builder) and chunk id ->
 * contenthash. Returns null if the manifests or the chunk are not present.
 */
export function resolveChunkUrl(html: string, chunkName: string): string | null {
  const builderIndex = html.search(/\.u\s*=\s*\w*\s*=>/);
  if (builderIndex === -1) return null;

  const nameMap = firstObjectLiteral(html, builderIndex);
  const chunkId = [...nameMap.matchAll(/(\d{3,7}):"([^"]+)"/g)].find(
    (m) => m[2] === chunkName
  )?.[1];
  if (chunkId === undefined) return null;

  const hash = [...html.matchAll(/(\d{3,7}):"([0-9a-f]{16})"/g)].find(
    (m) => m[1] === chunkId
  )?.[2];
  if (hash === undefined) return null;

  return `https://abs.twimg.com/responsive-web/client-web/${chunkName}.${hash}a.js`;
}

/** Resolves the Castle device-signals SDK bundle (`ondemand.castle`). */
export function resolveOndemandCastleUrl(html: string): string | null {
  return resolveChunkUrl(html, 'ondemand.castle');
}

const MIGRATION_REDIRECTION_REGEX =
  /(http(?:s)?:\/\/(?:www\.)?(twitter|x){1}\.com(\/x)?\/migrate([/?])?tok=[a-zA-Z0-9%\-_]+)+/;

/**
 * Follows x.com's twitter.com -> x.com migration hand-off and returns the parsed
 * home page, which carries the verification key the transaction id is derived from.
 */
export async function handleXMigration(
  session: TransactionSession,
  headers: Record<string, string>,
  url = 'https://x.com'
): Promise<{ root: CheerioRoot; html: string }> {
  let response = await session.request('GET', url, { headers });
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

  return { root: homePage, html: response.text };
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
