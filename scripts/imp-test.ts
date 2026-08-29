import { readFileSync } from 'node:fs';
import { Impit } from 'impit';
import { HttpSession } from '../src/internal/http.js';
import { TOKEN } from '../src/constants.js';

// Fresh cookies from the browser session you just logged into.
const st = JSON.parse(readFileSync('scripts/.storage.json', 'utf-8'));
const jar: Record<string, string> = {};
for (const c of st.cookies) if (c.domain.includes('x.com')) jar[c.name] = c.value;
const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
console.log('cookies used:', Object.keys(jar).join(', '));

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const headers: Record<string, string> = {
  accept: '*/*',
  'accept-language': 'en-US',
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
  cookie: cookieHeader,
  referer: 'https://x.com/home',
  'sec-ch-ua': '"Chromium";v="151", "Not(A:Brand";v="24", "Google Chrome";v="151"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': CHROME_UA,
  'x-csrf-token': jar.ct0 ?? '',
  'x-twitter-active-user': 'yes',
  'x-twitter-auth-type': 'OAuth2Session',
  'x-twitter-client-language': 'en',
};

// Endpoint that returns 200 in the browser and 404 from Node — no transaction id sent.
const URL = 'https://api.x.com/1.1/account/settings.json';

console.log('\n=== plain Node (control) ===');
const node = new HttpSession();
const nr = await node.request('GET', URL, { headers });
console.log(`  status ${nr.status} len=${nr.text.length}`);

console.log('\n=== impit, Chrome impersonation ===');
for (const browser of ['chrome', 'firefox'] as const) {
  try {
    const impit = new Impit({ browser, ignoreTlsErrors: false });
    const res = await impit.fetch(URL, { headers });
    const text = await res.text();
    console.log(`  ${browser}: status ${res.status} len=${text.length}` + (res.status === 200 ? '  <-- PASSES THE GATE' : ''));
    if (res.status === 200) console.log('    body head:', text.slice(0, 120));
  } catch (e) {
    console.log(`  ${browser}: threw ${(e as Error).message.slice(0, 120)}`);
  }
}
