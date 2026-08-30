/** Verify the library's Castle path WITHOUT any login call (rate-limit safe). */
import { HttpSession } from '../src/internal/http.js';
import { CastleSolver } from '../src/internal/castleSolver.js';
import { resolveOndemandCastleUrl } from '../src/transaction/utils.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const session = new HttpSession();

// Same steps NativeLoginFlow.create() performs — but stops before begin_login.
const html = (await session.request('GET', 'https://x.com/i/flow/login', { headers: { 'User-Agent': UA } })).text;

const pk = /"responsive_web_castle_public_key"\s*:\s*\{[^}]*?"value"\s*:\s*"([^"]+)"/.exec(html)?.[1];
console.log('pk read from login shell:', pk ?? 'FAILED');

const castleUrl = resolveOndemandCastleUrl(html);
console.log('castle SDK resolved:', castleUrl ? castleUrl.split('/').pop() : 'FAILED');
if (!pk || !castleUrl) process.exit(1);

const sdk = (await session.request('GET', castleUrl, { headers: { 'User-Agent': UA } })).text;
console.log('castle SDK fetched:', sdk.length, 'bytes');

const solver = new CastleSolver(sdk, pk, { userAgent: UA });
const token = await solver.createRequestToken();
console.log('\ntoken minted via library CastleSolver:', token.length, 'chars');
console.log('format valid:', /^[A-Za-z0-9_]+\|/.test(token), '| prefix:', token.split('|')[0]);
// mint a second to confirm reuse of the configured client
const token2 = await solver.createRequestToken();
console.log('second token (reused client):', token2.length, 'chars, distinct:', token !== token2);
