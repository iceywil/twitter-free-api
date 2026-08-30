/** ONE begin_login with a throwaway username, after a deliberate pause. */
import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { HttpSession } from '../src/internal/http.js';
import { ClientTransaction } from '../src/transaction/transaction.js';
import { resolveOndemandFileUrl, resolveOndemandCastleUrl } from '../src/transaction/utils.js';
import { CastleSolver } from '../src/internal/castleSolver.js';
import { TOKEN } from '../src/constants.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const EPOCH = 1682924400, KEYWORD = 'obfiowerehiring';
const ct = new ClientTransaction();
const session = new HttpSession();
const strings = (s: string) => [...s.matchAll(/[\x20-\x7e]{4,}/g)].map((m) => m[0]);

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
const tid = (m: string, p: string) => {
  const t = Math.floor((Date.now() - EPOCH * 1000) / 1000);
  const tb = [0, 1, 2, 3].map((i) => (t >> (i * 8)) & 0xff);
  const h = Array.from(createHash('sha256').update(`${m}!${p}!${t}${KEYWORD}${animationKey}`).digest());
  const r = randomBytes(1)[0];
  return Buffer.from([r, ...[...keyBytes, ...tb, ...h.slice(0, 16), 3].map((b) => b ^ r)]).toString('base64').replace(/=+$/, '');
};

const pk = /"responsive_web_castle_public_key"\s*:\s*\{[^}]*?"value"\s*:\s*"([^"]+)"/.exec(html)![1];
const sdk = (await session.request('GET', resolveOndemandCastleUrl(html)!, { headers: { 'User-Agent': UA } })).text;
const castle = new CastleSolver(sdk, pk, { userAgent: UA });

const [ga] = [(await session.request<any>('POST', 'https://api.x.com/1.1/guest/activate.json', {
  headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
})).data];

const path = '/i/jfapi/onboarding/web/actions/begin_login';
const body = new URLSearchParams();
body.append('username_or_email', 'zz_probe_' + randomBytes(4).toString('hex'));
body.append('$castle_token', await castle.createRequestToken());
const res = await session.request('POST', `https://x.com${path}`, {
  headers: {
    accept: '*/*', 'accept-language': 'en', authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/x-www-form-urlencoded', origin: 'https://x.com',
    referer: 'https://x.com/i/jf/onboarding/web?mode=login', 'User-Agent': UA,
    'x-client-transaction-id': tid('POST', path), 'x-guest-token': ga.guest_token,
    'x-jf-client-theme': 'light', 'x-jf-v': 'JP-5', 'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en', timezone: 'Europe/Paris',
  },
  data: body.toString(),
});
const s = strings(res.text);
const limited = s.some((x) => /temporarily limited/i.test(x));
const notFound = s.some((x) => /couldn.t find an active/i.test(x));
console.log(new Date().toISOString(), '| status', res.status);
console.log('  verdict:', limited ? 'RATE LIMITED' : notFound ? 'ACCEPTED (username lookup ran)' : 'OTHER');
console.log('  readable:', s.filter((x) => x.length > 8).slice(0, 4).join(' | '));
