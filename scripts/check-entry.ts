import { HttpSession } from '../src/internal/http.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const s = new HttpSession();
const html = (await s.request('GET', 'https://x.com', { headers: { 'User-Agent': UA } })).text;
const srcs = [...new Set([...html.matchAll(/src="(https:\/\/abs\.twimg\.com[^"]+\.js)"/g)].map((m) => m[1]))];
for (const url of srcs) {
  const js = (await s.request('GET', url, { headers: { 'User-Agent': UA } })).text;
  const hashPairs = [...js.matchAll(/(\d{3,7}):"([0-9a-f]{16})"/g)].length;
  const hasU = /\.u\s*=\s*\w*\s*=>/.test(js);
  const hasOd = js.includes('"ondemand.s"');
  console.log(`${url.split('/').pop()} (${js.length}b): .u=${hasU} ondemand.s=${hasOd} hashPairs=${hashPairs}`);
  if (hasOd) {
    const objectAt = (t: string, from: number) => {
      const st = t.indexOf('{', from); let d = 0;
      for (let i = st; i < t.length; i++) { if (t[i] === '{') d++; else if (t[i] === '}' && --d === 0) return t.slice(st, i + 1); }
      return '';
    };
    const nm = objectAt(js, js.search(/\.u\s*=\s*\w*\s*=>/));
    const id = [...nm.matchAll(/(\d{3,7}):"([^"]+)"/g)].find((m) => m[2] === 'ondemand.s')?.[1];
    const hash = [...js.matchAll(/(\d{3,7}):"([0-9a-f]{16})"/g)].find((m) => m[1] === id)?.[2];
    console.log(`   -> ondemand.s chunk=${id} hash=${hash}`);
  }
}
