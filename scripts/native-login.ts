/** Full native login: no browser. ONE begin_login + ONE login_enter_password. */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { HttpSession } from '../src/internal/http.js';
import { ClientTransaction } from '../src/transaction/transaction.js';
import { resolveOndemandFileUrl } from '../src/transaction/utils.js';
import { TOKEN } from '../src/constants.js';
import { mintCastleToken } from './mint-castle.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const EPOCH = 1682924400, KEYWORD = 'obfiowerehiring';
const ct = new ClientTransaction();
const session = new HttpSession();

const strings = (s: string) => [...s.matchAll(/[\x20-\x7e]{4,}/g)].map((m) => m[0]);
const CASTLE_PK = 'e8bl5yQW';

// --- transaction-id machinery ---
const [ga] = [(await session.request<any>('POST', 'https://api.x.com/1.1/guest/activate.json', {
  headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
})).data];
const guestToken = ga.guest_token;

const html = (await session.request('GET', 'https://x.com/login', { headers: { 'User-Agent': UA } })).text;
const $ = cheerio.load(html);
const key = $("[name='twitter-site-verification']").attr('content')!;
const frames: string[] = [];
$("[id^='loading-x-anim']").each((_, el) => { const d = $(el).children().first().children().eq(1).attr('d'); if (d) frames.push(d); });
const od = (await session.request('GET', resolveOndemandFileUrl(html)!, { headers: { 'User-Agent': UA } })).text;
const indices = [...od.matchAll(/(\(\w{1}\[(\d{1,2})\],\s*16\))+/g)].map((m) => Number(m[2]));
const keyBytes = Array.from(Buffer.from(key, 'base64'));
const row = frames[keyBytes[5] % 4].slice(9).split('C').map((s) => s.replace(/[^\d]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number))[keyBytes[indices[0]] % 16];
const animationKey = ct.animate(row, indices.slice(1).reduce((a, i) => a * (keyBytes[i] % 16), 1) / 4096);
const tid = (method: string, path: string) => {
  const t = Math.floor((Date.now() - EPOCH * 1000) / 1000);
  const tb = [0, 1, 2, 3].map((i) => (t >> (i * 8)) & 0xff);
  const h = Array.from(createHash('sha256').update(`${method}!${path}!${t}${KEYWORD}${animationKey}`).digest());
  const r = randomBytes(1)[0];
  return Buffer.from([r, ...[...keyBytes, ...tb, ...h.slice(0, 16), 3].map((b) => b ^ r)]).toString('base64').replace(/=+$/, '');
};
const jfHeaders = (path: string) => ({
  accept: '*/*', 'accept-language': 'en', authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/x-www-form-urlencoded', origin: 'https://x.com',
  referer: 'https://x.com/i/jf/onboarding/web?mode=login', 'User-Agent': UA,
  'x-client-transaction-id': tid('POST', path), 'x-guest-token': guestToken,
  'x-jf-client-theme': 'light', 'x-jf-v': 'JP-5', 'x-twitter-active-user': 'yes',
  'x-twitter-client-language': 'en', timezone: 'Europe/Paris',
});

const username = process.env.LOGIN_USERNAME || process.env.TWITTER_AUTH_INFO_1!;
const password = process.env.LOGIN_PASSWORD || process.env.TWITTER_PASSWORD!;

// --- STEP 1: begin_login ---
const p1 = '/i/jfapi/onboarding/web/actions/begin_login';
const b1 = new URLSearchParams();
b1.append('username_or_email', username);
b1.append('$castle_token', await mintCastleToken(CASTLE_PK));
const r1 = await session.request('POST', `https://x.com${p1}`, { headers: jfHeaders(p1), data: b1.toString() });
console.log('begin_login:', r1.status, `(${r1.text.length}b)`);
const s1 = strings(r1.text);
console.log("  full readable:", JSON.stringify(s1));
  const err1 = s1.find((s) => /limit|couldn't|incorrect|error|unable/i.test(s));
if (err1) { console.log('  ->', err1); console.log('  STOPPING (no password attempt made).'); process.exit(0); }

// session_token: a 36-char token in the response
const sessionToken = s1.find((s) => /^[A-Za-z0-9_-]{36}$/.test(s)) ?? s1.find((s) => s.length >= 30 && s.length <= 44 && /^[A-Za-z0-9_-]+$/.test(s));
console.log('  session_token:', sessionToken ? `found (${sessionToken.length} chars)` : 'NOT FOUND');
console.log('  readable:', s1.slice(0, 12).join(' | '));
if (!sessionToken) { console.log('  cannot proceed without session_token'); process.exit(1); }

// --- STEP 2: login_enter_password ---
const p2 = '/i/jfapi/onboarding/web/actions/login_enter_password';
const b2 = new URLSearchParams();
b2.append('username', username);
b2.append('password', password);
b2.append('session_token', sessionToken);
b2.append('$castle_token', await mintCastleToken(CASTLE_PK));
const r2 = await session.request('POST', `https://x.com${p2}`, { headers: jfHeaders(p2), data: b2.toString() });
console.log('\nlogin_enter_password:', r2.status, `(${r2.text.length}b)`);
const s2 = strings(r2.text);
console.log('  readable:', s2.slice(0, 14).join(' | '));

const cookies = session.getCookies();
console.log('\nauth_token acquired:', cookies.auth_token ? `YES (${cookies.auth_token.length} chars)` : 'no');
console.log('cookies:', Object.keys(cookies).join(', '));
