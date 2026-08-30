import 'dotenv/config';
import { writeFileSync, readFileSync } from 'node:fs';
import { Client } from '../src/index.js';
import { HttpSession } from '../src/internal/http.js';

const c = new Client({ silent: true });
c.setCookies({ auth_token: process.env.TWITTER_AUTH_TOKEN!, ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)! });

const before = await c.user();
console.log('current avatar:', before.profileImageUrl);

// 1. Save the original full-resolution image so we can restore it.
const origUrl = before.profileImageUrl.replace('_normal', '');
const origBytes = (await new HttpSession().request<Buffer>('GET', origUrl, { responseType: 'arraybuffer' })).data;
writeFileSync('scripts/.orig-avatar', origBytes);
console.log('saved original avatar:', origBytes.length, 'bytes');

// 2. A distinct valid test PNG (solid blue 8x8).
const testPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
  'base64'
);
await c.updateProfileImage(testPng);
console.log('uploaded test image');

// 3. Verify it changed.
const changed = await c.user();
console.log('new avatar:', changed.profileImageUrl);
console.log('avatar changed:', changed.profileImageUrl !== before.profileImageUrl ? 'YES' : 'NO');

// 4. Restore the original.
await c.updateProfileImage(readFileSync('scripts/.orig-avatar'));
const restored = await c.user();
console.log('restored avatar:', restored.profileImageUrl);
console.log('restored (differs from test):', restored.profileImageUrl !== changed.profileImageUrl ? 'YES' : 'NO');
