import 'dotenv/config';
import { Client } from '../src/index.js';
const c = new Client({ silent: true });
c.setCookies({ auth_token: process.env.TWITTER_AUTH_TOKEN!, ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)! });
const u = await c.user();
console.log(JSON.stringify({ name: u.name, screenName: u.screenName, description: u.description, location: u.location }));
