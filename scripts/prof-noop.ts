import 'dotenv/config';
import { Client } from '../src/index.js';
const c = new Client({ silent: true });
c.setCookies({ auth_token: process.env.TWITTER_AUTH_TOKEN!, ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)! });

const before = await c.user();
console.log('before:', { name: before.name, description: before.description });

// No-op: re-set the exact current values. Proves update_profile.json works.
const after = await c.updateProfile({ name: before.name, description: before.description });
console.log('after updateProfile (no-op):', { name: after.name, description: after.description });
console.log('endpoint works:', after.name === before.name && after.description === before.description ? 'YES' : 'values changed unexpectedly');
