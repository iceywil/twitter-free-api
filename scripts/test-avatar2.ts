import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from '../src/index.js';

const c = new Client({ silent: true });
c.setCookies({ auth_token: process.env.TWITTER_AUTH_TOKEN!, ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)! });

const before = await c.user();
console.log('avatar before:', before.profileImageUrl);

// Re-upload the account's own current avatar (a valid JPEG we saved earlier).
const bytes = readFileSync('scripts/.orig-avatar');
console.log('uploading valid JPEG:', bytes.length, 'bytes, sniffed type:',
  bytes[0] === 0xff && bytes[1] === 0xd8 ? 'JPEG' : 'other');
const res = await c.updateProfileImage(bytes);
console.log('upload status:', res.status);

const after = await c.user();
console.log('avatar after :', after.profileImageUrl);
console.log('endpoint works (URL reissued):', after.profileImageUrl !== before.profileImageUrl ? 'YES' : 'same URL');
