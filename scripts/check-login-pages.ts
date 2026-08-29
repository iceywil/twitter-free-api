import { HttpSession } from '../src/internal/http.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
for (const path of ['/login', '/i/flow/login', '/explore', '/home']) {
  const s = new HttpSession();
  const r = await s.request('GET', `https://x.com${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  const inline = [...r.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  console.log(
    `${path.padEnd(14)} ${r.status} ${String(r.text.length).padStart(7)}b` +
      ` manifest=${inline.includes('"ondemand.s"')}` +
      ` key=${/twitter-site-verification/.test(r.text)}` +
      ` frames=${(r.text.match(/loading-x-anim/g) || []).length}`
  );
}
