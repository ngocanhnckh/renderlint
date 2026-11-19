// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver; Bing feeds Copilot and ChatGPT search)
// about every URL in the sitemap. Run after a deploy: npm run indexnow
import fs from 'node:fs';
import path from 'node:path';
import { dist, SITE } from './lib.mjs';

const KEY = '1fa78449ca8fd82d298ed5ed90f7512b'; // public by design: served at /<key>.txt
const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urlList.length} URLs`);
if (res.status >= 300) { console.log(await res.text()); process.exit(1); }
