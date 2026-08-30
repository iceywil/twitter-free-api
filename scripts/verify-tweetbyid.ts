import 'dotenv/config';
import { Client } from '../src/index.js';
const c = new Client({ silent: true });
c.setCookies({ auth_token: process.env.TWITTER_AUTH_TOKEN!, ct0: (process.env.TWITTER_CT0 || process.env.TWTTER_CT0)! });
const tl = await c.getTimeline(5);
const tw = await c.getTweetById(tl[0]!.id);
console.log(`getTweetById OK: id=${tw.id} likes=${tw.favoriteCount} replies=${tw.replies?.length ?? 0} by @${tw.user?.screenName}`);
