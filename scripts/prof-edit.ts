import 'dotenv/config';
import { Client } from '../src/index.js';
const c = new Client({ silent: true });
c.setCookies({ auth_token: process.env.TWITTER_AUTH_TOKEN!, ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)! });

const orig = await c.user();
console.log('original :', { name: orig.name, description: orig.description });

// Real mutation.
const testBio = 'twikit-ts test bio ' + Date.now();
await c.updateProfile({ name: 'Bozo Test', description: testBio });
const changed = await c.user();
console.log('changed  :', { name: changed.name, description: changed.description });
const ok = changed.name === 'Bozo Test' && changed.description === testBio;
console.log('mutation applied:', ok ? 'YES' : 'NO');

// Restore.
await c.updateProfile({ name: orig.name, description: orig.description });
const restored = await c.user();
console.log('restored :', { name: restored.name, description: restored.description });
console.log('restored cleanly:', restored.name === orig.name && restored.description === orig.description ? 'YES' : 'NO');
