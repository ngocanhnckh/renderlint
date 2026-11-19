// Open Graph images (1200×630), rendered from HTML in Chromium; cached by a hash of their content.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { site, esc } from './lib.mjs';

const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(site, 'node_modules', f)).toString('base64')}`;

export async function ogImages(list) {
  const dir = path.join(site, 'static', 'og'); // committed, so hosts can build without a browser
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, '.hashes.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const poster = fs.readFileSync(path.join(site, 'static', 'media', 'hero-poster.jpg')).toString('base64');
  const todo = list.filter((o) => {
    const h = crypto.createHash('sha1').update(JSON.stringify(o) + poster.length + 'v4').digest('hex');
    o.hash = h;
    return manifest[o.name] !== h || !fs.existsSync(path.join(dir, `${o.name}.jpg`));
  });
  if (!todo.length) return;
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch {
    console.warn(`OG images out of date (${todo.map((o) => o.name).join(', ')}) and Playwright is not installed: keeping the old ones.`);
    return;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const serif = font('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2');
  const sans = font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
  for (const o of todo) {
    const size = o.title.length > 60 ? 64 : o.title.length > 38 ? 76 : 92;
    await page.setContent(`<!doctype html><html><head><style>
@font-face{font-family:S;src:url(${serif})}@font-face{font-family:I;src:url(${sans});font-weight:100 900}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:#e7e6e3;padding:18px;font-family:I}
.s{width:100%;height:100%;background:#fff;border-radius:30px;padding:14px;display:flex;gap:14px}
.l{flex:1;border-radius:22px;background:linear-gradient(180deg,#a8a8a6 0%,#c9c9c7 45%,#f2f2f1 100%);padding:44px 48px;display:flex;flex-direction:column}
.b{display:flex;align-items:center;gap:12px;font:600 28px/1 I;letter-spacing:-.02em}
.k{margin-top:auto;font:500 20px/1 I;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:12px}.k:before{content:"";width:28px;height:1.5px;background:#0c0c0c}
h1{font:400 ${size}px/.98 S;letter-spacing:-.025em;margin-top:22px;color:#0c0c0c}
.r{width:300px;border-radius:22px;background:#ec6a42 url(data:image/jpeg;base64,${poster}) center/cover}
</style></head><body><div class="s"><div class="l"><div class="b"><svg width="40" height="40" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="9" fill="#0c0c0c"/><rect x="8" y="10.5" width="16" height="11" rx="2.2" fill="none" stroke="#ec6a42" stroke-width="2.6"/><path d="M8 7h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>renderlint</div>
<div class="k">${esc(o.kicker)}</div><h1>${esc(o.title)}</h1></div><div class="r"></div></div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(dir, `${o.name}.jpg`), type: 'jpeg', quality: 86 });
    manifest[o.name] = o.hash;
  }
  await browser.close();
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}
