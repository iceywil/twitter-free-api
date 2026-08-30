/** ONE begin_login call to test whether a natively-minted Castle token is accepted. */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { HttpSession } from '../src/internal/http.js';
import { ClientTransaction } from '../src/transaction/transaction.js';
import { resolveOndemandFileUrl } from '../src/transaction/utils.js';
import { TOKEN } from '../src/constants.js';
import { mintCastleToken } from './mint-castle.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const EPOCH = 1682924400;
const KEYWORD = 'obfiowerehiring';
const ct = new ClientTransaction();
const session = new HttpSession();

// --- 1. guest token (fresh) ---
const [ga] = [(await session.request<any>('POST', 'https://api.x.com/1.1/guest/activate.json', {
  headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
})).data];
const guestToken = ga.guest_token;
console.log('guest token:', guestToken.slice(0, 10) + '…');

// --- 2. transaction-id inputs from /login (unauth shell) ---
const html = (await session.request('GET', 'https://x.com/login', { headers: { 'User-Agent': UA } })).text;
const $ = cheerio.load(html);
const key = $("[name='twitter-site-verification']").attr('content')!;
const frames: string[] = [];
$("[id^='loading-x-anim']").each((_, el) => { const d = $(el).children().first().children().eq(1).attr('d'); if (d) frames.push(d); });
const odUrl = resolveOndemandFileUrl(html)!;
const od = (await session.request('GET', odUrl, { headers: { 'User-Agent': UA } })).text;
const indices = [...od.matchAll(/(\(\w{1}\[(\d{1,2})\],\s*16\))+/g)].map((m) => Number(m[2]));

const keyBytes = Array.from(Buffer.from(key, 'base64'));
const rowIndex = keyBytes[indices[0]] % 16;
const frameTime = indices.slice(1).reduce((a, i) => a * (keyBytes[i] % 16), 1);
const row = frames[keyBytes[5] % 4].slice(9).split('C').map((s) => s.replace(/[^\d]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number))[rowIndex];
const animationKey = ct.animate(row, frameTime / 4096);
const mintTid = (method: string, path: string) => {
  const t = Math.floor((Date.now() - EPOCH * 1000) / 1000);
  const tb = [0, 1, 2, 3].map((i) => (t >> (i * 8)) & 0xff);
  const h = Array.from(createHash('sha256').update(`${method}!${path}!${t}${KEYWORD}${animationKey}`).digest());
  const r = randomBytes(1)[0];
  const arr = [...keyBytes, ...tb, ...h.slice(0, 16), 3];
  return Buffer.from([r, ...arr.map((b) => b ^ r)]).toString('base64').replace(/=+$/, '');
};
console.log('transaction id: generated natively');

// --- 3. native castle token ---
// pk prefix observed in captured tokens; the SDK is configured with this pk.
const castle = await mintCastleToken('e8bl5yQW');
console.log('castle token: minted natively,', castle.length, 'chars');

// --- 4. ONE begin_login with a throwaway username (protects both real accounts) ---
const path = '/i/jfapi/onboarding/web/actions/begin_login';
const body = new URLSearchParams();
body.append('username_or_email', 'zz_probe_' + randomBytes(4).toString('hex'));
body.append('$castle_token', castle);

const res = await session.request('POST', `https://x.com${path}`, {
  headers: {
    accept: '*/*', 'accept-language': 'en', authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/x-www-form-urlencoded', origin: 'https://x.com',
    referer: 'https://x.com/i/jf/onboarding/web?mode=login', 'User-Agent': UA,
    'x-client-transaction-id': mintTid('POST', path), 'x-guest-token': guestToken,
    'x-jf-client-theme': 'light', 'x-jf-v': 'JP-5',
    'x-twitter-active-user': 'yes', 'x-twitter-client-language': 'en',
    timezone: 'Europe/Paris',
  },
  data: body.toString(),
});

console.log('\n=== begin_login response ===');
console.log('status:', res.status, '| bytes:', res.text.length);
// Response is a length-delimited binary blob with embedded text; extract readable runs.
const readable = [...res.text.matchAll(/[\x20-\x7e]{6,}/g)].map((m) => m[0]);
console.log('readable strings:');
readable.slice(0, 20).forEach((s) => console.log('   ', s));

const lower = res.text.toLowerCase();
console.log('\nverdict signals:');
console.log('  "limited"/"try again":', /limit|try again/i.test(res.text));
console.log('  "castle"/"token":', /castle|invalid.*token/i.test(res.text));
console.log('  username-level (not found / does not exist / enter):', /not found|does not exist|enter_password|session_token|no account/i.test(res.text));
