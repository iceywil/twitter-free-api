import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { HttpSession } from '../src/internal/http.js';

const cap = JSON.parse(readFileSync('scripts/.capture.json', 'utf-8'));
const req = cap.captured[0];
const h: Record<string, string> = req.headers;

// Rebuild the absolute URL from the HTTP/2 pseudo-headers.
const url = `https://${h[':authority']}${h[':path']}`;

// Drop pseudo-headers; keep everything else exactly as Chrome sent it.
const headers: Record<string, string> = {};
for (const [k, v] of Object.entries(h)) {
  if (k.startsWith(':')) continue;
  headers[k] = v;
}
headers['accept-encoding'] = 'gzip, deflate, br'; // node has no zstd

const session = new HttpSession();

async function attempt(label: string, hdrs: Record<string, string>) {
  const r = await session.request('GET', url, { headers: hdrs });
  const ok = r.status === 200 && r.text.length > 1000;
  console.log(
    `  ${label.padEnd(42)} ${r.status} len=${String(r.text.length).padStart(7)} ${ok ? '<-- WORKS' : ''}`
  );
  return ok;
}

console.log('Replaying the captured browser request from Node:');
await attempt('1 verbatim (all headers + cookie + tid)', headers);

const noTid = { ...headers };
delete noTid['x-client-transaction-id'];
await attempt('2 verbatim minus transaction-id', noTid);

const minimalCookie = {
  ...headers,
  cookie: `auth_token=${process.env.TWITTER_AUTH_TOKEN}; ct0=${process.env.TWITTER_CT0 || process.env.TWTTER_CT0}`,
};
await attempt('3 verbatim, only auth_token+ct0 cookies', minimalCookie);

const noSec = { ...headers };
for (const k of Object.keys(noSec)) if (k.startsWith('sec-') || k === 'priority') delete noSec[k];
await attempt('4 verbatim minus sec-* / priority', noSec);
