import 'dotenv/config';
import { Client } from '../src/index.js';

const client = new Client({ silent: true });
client.setCookies({
  auth_token: process.env.TWITTER_CT0_2!,   // values are swapped in .env
  ct0: process.env.TWITTER_AUTH_TOKEN_2!,
});
const me = await client.user();
console.log(`account 2: @${me.screenName} (id=${me.id})`);
