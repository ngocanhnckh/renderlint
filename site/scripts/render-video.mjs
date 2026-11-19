// Builds the HyperFrames composition for the hero clip from real renderlint data, then renders it.
//
// 1. Runs renderlint on examples-src/overflow-before.html and keeps the findings it reports at 375px.
// 2. Screenshots overflow-before / overflow-after at 375px and measures the flagged elements, so the
//    boxes in the clip sit exactly where renderlint put them in its own annotated screenshot.
// 3. Writes video/hero/index.html: a HyperFrames composition (HTML + a paused GSAP timeline).
// 4. Renders it with the HyperFrames CLI (needs Node 22+: set HYPERFRAMES_BIN to its `hyperframes`
//    binary and HYPERFRAMES_NODE to a Node 22 binary) and writes static/media/hero.{mp4,webm,jpg,webp}.
//
// `node scripts/render-video.mjs --compose-only` stops after step 3.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const repo = path.resolve(site, '..');
const comp = path.join(site, 'video', 'hero');
const media = path.join(site, 'static', 'media');
const tmp = path.join(site, '.renderlint', 'video');
fs.mkdirSync(comp, { recursive: true });
fs.mkdirSync(media, { recursive: true });

// ---- 1. real findings -------------------------------------------------------------------------
const before = path.join(site, 'examples-src', 'overflow-before.html');
const after = path.join(site, 'examples-src', 'overflow-after.html');
fs.rmSync(tmp, { recursive: true, force: true });
try {
  execFileSync('node', [path.join(repo, 'bin/renderlint.js'), before, '--no-crawl', '--format', 'json', '--out', tmp], { stdio: 'ignore' });
} catch { /* exits 1: errors found, as expected */ }
const report = JSON.parse(fs.readFileSync(path.join(tmp, 'report.json'), 'utf8'));
const at375 = report.issues.filter((i) => i.severity === 'error' && i.viewports.includes(375));
const errors = report.stats.errors;
const warnings = report.stats.warnings;
const byRule = {};
for (const i of at375) (byRule[i.rule] ||= []).push(i);
console.log('findings at 375px:', at375.map((i) => `${i.rule}: ${i.message}`));

// ---- 2. screenshots and element boxes ---------------------------------------------------------
const SCALE = 1.6; // css px → video px for the phone screen
const SCREEN = { w: 375, h: 540 };
const browser = await chromium.launch();
async function shoot(file, out) {
  const page = await browser.newPage({ viewport: { width: SCREEN.w, height: SCREEN.h }, deviceScaleFactor: SCALE });
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(200);
  await page.screenshot({ path: out });
  return page;
}
const page = await shoot(before, path.join(comp, 'before.png'));
// renderlint groups "×2 similar elements" under one finding: box every element it covers.
const boxes = [];
let n = 1;
for (const rule of ['text-overflow', 'text-clipped']) {
  for (const issue of byRule[rule] || []) {
    const sels = [issue.selector];
    if (rule === 'text-clipped') sels.push(issue.selector.replace('div.card.kpi:nth-of-type(1)', 'div.card.kpi:nth-of-type(2)'));
    for (const sel of sels) {
      const r = await page.locator(sel).first().boundingBox();
      if (r) boxes.push({ n: n++, rule, x: r.x, y: r.y, w: r.width, h: r.height, msg: issue.message });
    }
  }
}
await page.close();
await (await shoot(after, path.join(comp, 'after.png'))).close();
await browser.close();
fs.writeFileSync(path.join(comp, 'findings.json'), JSON.stringify({ errors, warnings, boxes }, null, 2) + '\n');

for (const f of ['inter-latin-wght-normal.woff2']) fs.copyFileSync(path.join(site, 'node_modules/@fontsource-variable/inter/files', f), path.join(comp, f));
for (const f of ['jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-500-normal.woff2']) fs.copyFileSync(path.join(site, 'node_modules/@fontsource/jetbrains-mono/files', f), path.join(comp, f));
fs.copyFileSync(path.join(site, 'node_modules/gsap/dist/gsap.min.js'), path.join(comp, 'gsap.min.js'));

// ---- 3. composition ---------------------------------------------------------------------------
const W = 960, H = 1080, DUR = 10;
const PHONE = { x: 56, y: 56, pad: 12 };
const sx = (v) => PHONE.x + PHONE.pad + v * SCALE;
const sy = (v) => PHONE.y + PHONE.pad + v * SCALE;
const short = (m) => m.replace(/^Text (spills outside its (container|box)|is cut off by an overflow:hidden container) \(/, '').replace(/\)\.?$/, '');
const tO = byRule['text-overflow'] || [];
const tC = byRule['text-clipped'] || [];
// Terminal lines: shortened from the real report (rule, count, the measured overflow).
const lines = [
  { cls: 'dim', t: 'renderlint — 375px, 768px, 1280px' },
  { cls: 'err', t: `✖ text-overflow (${tO.length})` },
  ...tO.map((i) => ({ cls: '', t: `  ${short(i.message)}` })),
  { cls: 'err', t: `✖ text-clipped (${tC.length}) ×2 similar` },
  ...tC.map((i) => ({ cls: '', t: `  ${short(i.message)}` })),
  { cls: 'err strong', t: `✖ ${errors} error(s), ${warnings} warning(s)` },
];
const fix = [
  { cls: 'dim', t: '/* the fixes from the report */' },
  { cls: 'del', t: '- .acct p   { white-space: nowrap }' },
  { cls: 'add', t: '+ .acct p   { overflow-wrap: anywhere }' },
  { cls: 'add', t: '+ .kpi      { min-width: 0 }' },
  { cls: 'del', t: '- .btn      { width: 160px }' },
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${W}, height=${H}">
<!-- Generated by site/scripts/render-video.mjs from real renderlint output. Do not edit by hand. -->
<script src="gsap.min.js"></script>
<style>
@font-face{font-family:Inter;src:url(inter-latin-wght-normal.woff2) format("woff2");font-weight:100 900}
@font-face{font-family:"JetBrains Mono";src:url(jetbrains-mono-latin-400-normal.woff2) format("woff2");font-weight:400}
@font-face{font-family:"JetBrains Mono";src:url(jetbrains-mono-latin-500-normal.woff2) format("woff2");font-weight:500}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#ee6a43}
#root{position:relative;width:100%;height:100%;font-family:Inter,sans-serif;
  background:radial-gradient(120% 90% at 85% 10%,#f6a07f 0%,#ee6a43 45%,#d9532d 100%)}
.phone{position:absolute;left:${PHONE.x}px;top:${PHONE.y}px;width:${SCREEN.w * SCALE + PHONE.pad * 2}px;height:${SCREEN.h * SCALE + PHONE.pad * 2}px;
  background:#0d0d0d;border-radius:56px;padding:${PHONE.pad}px;box-shadow:0 40px 80px rgba(80,20,0,.35)}
.screen{position:relative;width:100%;height:100%;border-radius:44px;overflow:hidden;background:#f4f4f5}
.screen img{position:absolute;inset:0;width:100%;height:100%}
#after{opacity:0}
.box{position:absolute;border:3px solid #e11d48;border-radius:4px;opacity:0;transform:scale(1.15)}
.tag{position:absolute;left:-3px;top:-34px;white-space:nowrap;background:#e11d48;color:#fff;font:600 19px/1 Inter;padding:6px 9px;border-radius:5px}
.term{position:absolute;left:326px;top:600px;width:604px;height:420px;border-radius:28px;padding:30px 32px;
  background:#0e0e10;box-shadow:0 30px 70px rgba(60,10,0,.4);font:400 22px/1.55 "JetBrains Mono",monospace;color:#e7e7e9;overflow:hidden}
.term .bar{display:flex;gap:9px;margin-bottom:18px}.term .bar i{width:13px;height:13px;border-radius:50%;background:#3a3a3e}
.l{white-space:pre;opacity:0}.dim{color:#9c9ca3}.err{color:#ff8a7a}.strong{font-weight:500}.ok{color:#7ee2a8;font-weight:500}
.del{color:#ff8a7a}.add{color:#7ee2a8}.prompt{color:#fff}
.caret{display:inline-block;width:12px;height:24px;background:#e7e7e9;vertical-align:-4px;margin-left:2px}
.chip{position:absolute;display:flex;align-items:center;gap:16px;background:#fff;border-radius:999px;padding:16px 28px 16px 16px;
  font:500 26px/1 Inter;color:#111;box-shadow:0 18px 40px rgba(80,20,0,.22)}
.chip .ck{width:40px;height:40px;border-radius:12px;display:grid;place-items:center}
.chip .ck svg{width:24px;height:24px}
#chip1{left:560px;top:150px}#chip2{left:610px;top:248px}
#chip2 .ck{background:#ee6a43}#chip2b{left:610px;top:248px;opacity:0}#chip2b .ck{background:#2f8cf0}
.panel{position:absolute;inset:0}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}" data-width="${W}" data-height="${H}">
 <div class="panel clip" data-start="0" data-duration="${DUR}" data-track-index="0">
  <div class="phone"><div class="screen">
   <img id="before" src="before.png" alt="">
   <img id="after" src="after.png" alt="">
  </div></div>
  ${boxes.map((b) => `<div class="box" id="b${b.n}" style="left:${sx(b.x) - 4}px;top:${sy(b.y) - 4}px;width:${b.w * SCALE + 8}px;height:${b.h * SCALE + 8}px"><span class="tag">#${b.n} ${b.rule}</span></div>`).join('\n  ')}
  <div class="chip" id="chip1"><span class="ck" style="background:#111"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg></span>Rendered at 375px</div>
  <div class="chip" id="chip2"><span class="ck"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg></span>${errors} errors found</div>
  <div class="chip" id="chip2b"><span class="ck"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg></span>0 errors</div>
  <div class="term">
   <div class="bar"><i></i><i></i><i></i></div>
   <div id="run1">
    <div class="l prompt" id="p1">$ npx renderlint<span class="caret" id="c1"></span></div>
    ${lines.map((l, i) => `<div class="l ${l.cls}" id="o${i}">${esc(l.t)}</div>`).join('\n    ')}
   </div>
   <div id="run2" style="position:absolute;left:32px;right:32px;top:79px;opacity:0">
    ${fix.map((l, i) => `<div class="l ${l.cls}" id="f${i}">${esc(l.t)}</div>`).join('\n    ')}
    <div class="l prompt" id="p2" style="margin-top:14px">$ npx renderlint</div>
    <div class="l dim" id="q0">renderlint — 375px, 768px, 1280px</div>
    <div class="l ok" id="q1">✔ No UI defects found.</div>
   </div>
  </div>
 </div>
</div>
<script>
const tl = gsap.timeline({ paused: true });
const E = 'power3.out';
// run 1: check, report, box each finding
tl.to('#p1', { opacity: 1, duration: 0.2 }, 0.2);
tl.to('#c1', { opacity: 0, duration: 0.01, repeat: 5, yoyo: true, repeatDelay: 0.14 }, 0.2);
tl.to('#o0', { opacity: 1, duration: 0.25 }, 1.0);
${boxes.map((b, i) => `tl.to('#b${b.n}', { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, ${(1.4 + i * 0.32).toFixed(2)});`).join('\n')}
${lines.slice(1).map((l, i) => `tl.to('#o${i + 1}', { opacity: 1, duration: 0.2 }, ${(1.4 + i * 0.26).toFixed(2)});`).join('\n')}
tl.fromTo('#chip2', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: E }, 2.9);
// fix
tl.to('#run1', { opacity: 0, duration: 0.3 }, 3.9);
tl.to('#run2', { opacity: 1, duration: 0.01 }, 4.2);
${fix.map((l, i) => `tl.to('#f${i}', { opacity: 1, duration: 0.2 }, ${(4.2 + i * 0.22).toFixed(2)});`).join('\n')}
tl.to('.box', { opacity: 0, duration: 0.35 }, 5.3);
tl.to('#after', { opacity: 1, duration: 0.6, ease: 'power2.inOut' }, 5.4);
// run 2: clean
tl.to('#p2', { opacity: 1, duration: 0.2 }, 6.0);
tl.to('#q0', { opacity: 1, duration: 0.2 }, 6.6);
tl.to('#q1', { opacity: 1, duration: 0.25 }, 7.0);
tl.to('#chip2', { opacity: 0, y: -10, duration: 0.3 }, 7.0);
tl.fromTo('#chip2b', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: E }, 7.1);
// back to the first frame so the loop is seamless
tl.to(['#after', '#run2', '#chip2b'], { opacity: 0, duration: 0.5, ease: 'power2.inOut' }, 9.4);
tl.set('#run1', { opacity: 1 }, 9.9);
tl.set('#run1 .l', { opacity: 0 }, 9.9);
tl.set(['#run2 .l', '.box'], { opacity: 0 }, 9.9);
tl.set('.box', { scale: 1.15 }, 9.9);
tl.to({}, { duration: 0.01 }, ${DUR - 0.01});
window.__timelines = window.__timelines || {};
window.__timelines['main'] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(comp, 'index.html'), html);
fs.writeFileSync(path.join(comp, 'hyperframes.json'), JSON.stringify({ paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } }, null, 2) + '\n');
fs.rmSync(path.join(site, '.renderlint'), { recursive: true, force: true });
console.log('composition written:', path.relative(site, comp));
if (process.argv.includes('--compose-only')) process.exit(0);

// ---- 4. render --------------------------------------------------------------------------------
const bin = process.env.HYPERFRAMES_BIN;
const node = process.env.HYPERFRAMES_NODE || 'node';
if (!bin) throw new Error('Set HYPERFRAMES_BIN to the hyperframes CLI (and HYPERFRAMES_NODE to Node 22+).');
const env = { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH}`, DO_NOT_TRACK: '1', HYPERFRAMES_TELEMETRY: '0' };
const raw = path.join(tmp, 'hero-raw.mp4');
fs.mkdirSync(tmp, { recursive: true });
execFileSync(node, [bin, 'render', comp, '-o', raw, '--fps', '30', '--quality', 'delivery', '--workers', '2', '--quiet'], { stdio: 'inherit', env });
// Web encodes: small H.264 for Safari/iOS, VP9 WebM for the rest; half resolution is enough at the size it's shown.
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
ff(['-i', raw, '-vf', 'scale=720:-2', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'veryslow', '-movflags', '+faststart', '-an', path.join(media, 'hero.mp4')]);
ff(['-i', raw, '-vf', 'scale=720:-2', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-an', path.join(media, 'hero.webm')]);
// Poster: the frame with every finding boxed (shown before the video loads and with reduced motion).
const posterPng = path.join(tmp, 'poster.png');
ff(['-ss', '3.6', '-i', raw, '-frames:v', '1', posterPng]);
await sharp(posterPng).resize(720).webp({ quality: 78 }).toFile(path.join(media, 'hero-poster.webp'));
await sharp(posterPng).resize(720).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(media, 'hero-poster.jpg'));
fs.rmSync(path.join(site, '.renderlint'), { recursive: true, force: true });
for (const f of fs.readdirSync(media)) console.log(f, Math.round(fs.statSync(path.join(media, f)).size / 1024) + ' KB');
