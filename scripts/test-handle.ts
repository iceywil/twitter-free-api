import 'dotenv/config';
import { Client } from '../src/index.js';

const c = new Client({ silent: true });
c.setCookies({ auth_token: process.env.TWITTER_AUTH_TOKEN!, ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)! });

const before = await c.user();
const original = before.screenName;
console.log('handle before:', '@' + original, '(id', before.id + ')');

// Change to a temporary handle derived from the id (very unlikely to be taken).
const temp = 'bozo_t' + before.id.slice(-6);
const res = await c.updateScreenName(temp);
console.log('updateScreenName status:', res.status);

const changed = await c.user();
console.log('handle after :', '@' + changed.screenName);
console.log('changed:', changed.screenName === temp ? 'YES' : 'NO', '| id unchanged:', changed.id === before.id ? 'YES' : 'NO');

// Restore immediately.
await c.updateScreenName(original);
const restored = await c.user();
console.log('handle restored:', '@' + restored.screenName, restored.screenName === original ? '(OK)' : '(FAILED)');
