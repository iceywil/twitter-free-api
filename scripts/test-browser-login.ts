import 'dotenv/config';
import { browserLogin } from '../src/browser/index.ts';
import { Client } from '../src/index.js';

console.log('Running browserLogin (headless)...');
const result = await browserLogin({
  authInfo1: process.env.TWITTER_AUTH_INFO_1!,
  authInfo2: process.env.TWITTER_AUTH_INFO_2,
  password: process.env.TWITTER_PASSWORD!,
  totpSecret: process.env.TWITTER_TOTP_SECRET || undefined,
  useChrome: true,
  timeout: 45_000,
});

console.log('cookies harvested:', Object.keys(result.cookies).join(', '));
console.log('auth_token:', result.authToken ? `present (${result.authToken.length} chars)` : 'MISSING');
console.log('ct0:', result.ct0 ? `present (${result.ct0.length} chars)` : 'MISSING');

// Prove the cookies work with the plain Node client.
const client = new Client({ silent: true });
client.setCookies(result.cookies);
const me = await client.user();
console.log(`\nlogged in as @${me.screenName} (id=${me.id}) — cookies are valid`);
