import 'dotenv/config';
import { browserLogin } from '../src/browser/index.ts';
import { Client } from '../src/index.js';

const username = process.env.TWITTER_USERNAME_3!;
const password = process.env.TWITTER_PASSWORD_3!;
console.log(`browserLogin for @${username} (headed so the flow is visible)...`);

const result = await browserLogin({
  authInfo1: username,
  password,
  headed: true,
  useChrome: true,
  timeout: 60_000,
});

console.log('cookies:', Object.keys(result.cookies).join(', '));
console.log('auth_token:', result.authToken ? `present (${result.authToken.length})` : 'MISSING');

if (result.authToken) {
  const client = new Client({ silent: true });
  client.setCookies(result.cookies);
  const me = await client.user();
  console.log(`\nLOGGED IN NATIVELY as @${me.screenName} (id=${me.id}) — full flow works`);
}
