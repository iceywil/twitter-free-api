import { writeFileSync, readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { HttpSession } from '../src/internal/http.js';

const session = new HttpSession();
const html = (await session.request('GET', 'https://x.com', {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  },
})).text;

const $ = cheerio.load(html);
const key = $("[name='twitter-site-verification']").attr('content') ?? null;
const frames: string[] = [];
$("[id^='loading-x-anim']").each((_, el) => {
  const g = $(el).children().first();
  const d = g.children().eq(1).attr('d');
  if (d) frames.push(d);
});

const loggedIn = JSON.parse(readFileSync('scripts/.tid-samples.json', 'utf-8')).pageData.key;
console.log('logged-out key:', key?.slice(0, 16) + '...', `(${key?.length} chars)`);
console.log('logged-in  key:', loggedIn?.slice(0, 16) + '...', `(${loggedIn?.length} chars)`);
console.log('keys identical:', key === loggedIn ? 'YES - deployment constant' : 'NO - per-session');
console.log('frames extracted:', frames.length);
frames.forEach((f, i) => console.log(`  frame[${i}] d= ${f.slice(0, 60)}... (${f.length} chars)`));

writeFileSync('scripts/.frames.json', JSON.stringify({ key, frames }, null, 2));
