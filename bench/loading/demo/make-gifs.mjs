// Animated GIFs for the README: a real page from the bench app, what renderlint does to it (holds
// its data, clicks, empties its lists, presses Escape), and the warning renderlint prints for it.
// The page states are real screenshots and the warnings come from a real renderlint run.
//   (cd bench/loading/app && npm install && npm run dev)   then:   node bench/loading/demo/make-gifs.mjs [scene…]
// Needs ffmpeg. Writes docs/images/demo-*.gif.
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { check } from '../../../src/index.js';
import { launchBrowser } from '../../../src/browser.js';
import { emptyLists } from '../../../src/waiting.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../../../docs/images');
const WORK = join(tmpdir(), 'renderlint-gifs');
const APP = 'http://localhost:5393';
const VW = 1280, VH = 520;          // the app's viewport
const SCALE = 0.75;                  // shown at 960×390
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
const stage = await (await browser.newContext({ viewport: { width: 960, height: 610 } })).newPage();
await stage.setContent(STAGE_HTML());

// ---- the warnings, from renderlint itself
// renderlint's finding for the rule on that page (a timing check can miss once on a busy machine: retried)
async function finding(path, rule, opts) {
  for (let i = 0; i < 3; i++) { const f = (await findings(path, opts)).find((x) => x.rule === rule); if (f) return f; }
  throw new Error(`no ${rule} finding on ${path}`);
}
async function findings(path, { ux = true } = {}) {
  const res = await check({ targets: [APP + path], browser, scan: false, configFile: false, cwd: WORK,
    config: { crawl: false, routes: false, screenshots: false, outputDir: join(WORK, 'out'), viewports: [VW], colorSchemes: ['light'], sweep: false, stress: false, ux } });
  return res.issues;
}
const short = (msg, max = 300) => {
  if (msg.length <= max) return msg;
  const cut = msg.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(': '));
  return (end > 140 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')) + ' …';
};
const termFor = (cmd, issue) => [
  { t: '$ ' + cmd, c: 'cmd' },
  { t: '⚠ ' + issue.rule, c: 'rule' },
  { t: '  warn  ' + short(issue.message), c: 'msg' },
  { t: '        at ' + issue.selector, c: 'at' },
];

// ---- frames
const png = async (page) => 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
const S = (r) => r && { x: r.x * SCALE, y: r.y * SCALE, w: r.w * SCALE, h: r.h * SCALE };
async function centerOf(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  return { x: (b.x + b.width / 2) * SCALE, y: (b.y + b.height / 2) * SCALE };
}
function scene(name) {
  const frames = [];
  let state = { img: '', url: '', cursor: null, chips: [], boxes: [], term: [], key: '' };
  return {
    name,
    set(patch) { state = { ...state, ...patch }; return this; },
    hold(ms) { frames.push({ state: { ...state }, ms }); return this; },
    move(to, ms = 600, fps = 15) {
      const from = state.cursor || { x: to.x + 160, y: to.y + 120 };
      const n = Math.max(2, Math.round((ms / 1000) * fps));
      for (let i = 1; i <= n; i++) {
        const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        state = { ...state, cursor: { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, down: false } };
        frames.push({ state: { ...state }, ms: ms / n });
      }
      return this;
    },
    click(ms = 160) { this.set({ cursor: { ...state.cursor, down: true } }).hold(ms); return this.set({ cursor: { ...state.cursor, down: false } }); },
    type(lines, ms = 450) { for (let i = 1; i <= lines.length; i++) this.set({ term: lines.slice(0, i) }).hold(i === lines.length ? 0 : ms); return this; },
    count(label, tone, secs, step = 0.1, base = []) { // a chip counting up: "Main thread blocked 0.1s … 1.5s"
      for (let t = step; t <= secs + 1e-9; t += step) this.set({ chips: [...base, { t: label.replace('#', t.toFixed(1) + 's'), tone }] }).hold(step * 1000);
      return this;
    },
    frames,
  };
}

async function encode(sc) {
  const dir = join(WORK, sc.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const list = [];
  let last = null, n = 0;
  for (const f of sc.frames) {
    if (f.ms <= 0) continue;
    const key = JSON.stringify(f.state);
    if (key === last) { list[list.length - 1].ms += f.ms; continue; }
    last = key;
    await stage.evaluate((s) => window.render(s), f.state);
    const file = join(dir, String(n++).padStart(4, '0') + '.png');
    await stage.screenshot({ path: file });
    list.push({ file, ms: f.ms });
  }
  const concat = list.map((x) => `file '${x.file}'\nduration ${(x.ms / 1000).toFixed(3)}`).join('\n') + `\nfile '${list[list.length - 1].file}'\n`;
  writeFileSync(join(dir, 'list.txt'), concat);
  const gif = join(OUT, `demo-${sc.name}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-fps_mode', 'vfr', '-loop', '0', gif]);
  console.log(`${gif}  ${list.length} frames, ${(statSync(gif).size / 1024).toFixed(0)} KB`);
}

// ---- scenes
const SCENES = {
  // the page loads its data with nothing on screen meanwhile
  async loading() {
    const path = '/s/load-bad-whole';
    const issue = await finding(path, 'loading-state', { ux: false });
    const page = await ctx.newPage();
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/api/**', async (route) => { await gate; return route.fallback(); });
    await page.goto(APP + path);
    await sleep(800);
    const blank = await png(page);
    release();
    await page.waitForLoadState('networkidle');
    await sleep(300);
    const full = await png(page);
    await page.close();
    const sc = scene('loading-state').set({ url: 'localhost:5393' + path, img: blank });
    sc.hold(500).count('renderlint holds GET /api/me, /api/orders: #', 'info', 1.0, 0.1)
      .set({ chips: [{ t: '1s in: nothing on screen', tone: 'bad' }] }).hold(1100)
      .set({ img: full, chips: [{ t: 'data released', tone: 'info' }], boxes: [S(issue.rect)] }).hold(700)
      .type(termFor('npx renderlint', issue)).hold(4200);
    return sc;
  },
  // a click blocks the main thread
  async freeze() {
    const path = '/s/freeze-bad-click';
    const issue = await finding(path, 'ui-freeze');
    const page = await ctx.newPage();
    await page.goto(APP + path);
    await page.waitForLoadState('networkidle');
    const before = await png(page);
    const btn = await centerOf(page, 'text=Generate report');
    await page.click('text=Generate report');
    await sleep(200);
    const after = await png(page);
    await page.close();
    const sc = scene('ui-freeze').set({ url: 'localhost:5393' + path, img: before });
    sc.hold(500).move(btn, 700).click()
      .count('page frozen: #', 'bad', 1.5, 0.1)
      .set({ img: after, chips: [{ t: 'page frozen for 1.5s', tone: 'bad' }], boxes: [S(issue.rect)] }).hold(500)
      .type(termFor('npx renderlint --ux', issue)).hold(4200);
    return sc;
  },
  // a save fails and the page says nothing
  async failure() {
    const path = '/s/u-err-bad-save';
    const issue = await finding(path, 'error-feedback');
    const page = await ctx.newPage();
    await page.route('**/api/settings', async (route) => { await sleep(1200); return route.fulfill({ status: 500, body: '{}' }); });
    await page.goto(APP + path);
    await page.waitForLoadState('networkidle');
    const empty = await png(page);
    const field = await centerOf(page, 'input[name=store]');
    await page.fill('input[name=store]', 'Acme Goods');
    const filled = await png(page);
    const btn = await centerOf(page, 'text=Save changes');
    await page.click('text=Save changes');
    await sleep(300);
    const saving = await png(page);
    await sleep(1400);
    const after = await png(page);
    await page.close();
    const sc = scene('error-feedback').set({ url: 'localhost:5393' + path, img: empty });
    sc.hold(400).move(field, 600).click().set({ img: filled, chips: [{ t: 'test data filled in', tone: 'info' }] }).hold(600)
      .move(btn, 500).click().set({ img: saving, chips: [{ t: 'renderlint answers POST /api/settings with HTTP 500', tone: 'info' }] }).hold(1100)
      .set({ img: after, chips: [{ t: 'the save failed: nothing says so', tone: 'bad' }], boxes: [S(issue.rect)] }).hold(1200)
      .type(termFor('npx renderlint --ux', issue)).hold(4200);
    return sc;
  },
  // a new account: the list comes back empty and the table is just empty
  async empty() {
    const path = '/s/v-empty-bad-table';
    const issue = await finding(path, 'empty-state');
    const page = await ctx.newPage();
    await page.goto(APP + path);
    await page.waitForLoadState('networkidle');
    const full = await png(page);
    await page.route('**/api/orders*', async (route) => { const res = await route.fetch(); return route.fulfill({ response: res, body: JSON.stringify(emptyLists(await res.json())[0]) }); });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await sleep(200);
    const empty = await png(page);
    await page.close();
    const sc = scene('empty-state').set({ url: 'localhost:5393' + path, img: full });
    sc.hold(900).set({ chips: [{ t: 'renderlint answers GET /api/orders with { "items": [] }', tone: 'info' }] }).hold(1200)
      .set({ img: empty, chips: [{ t: 'a new account: no message, no next step', tone: 'bad' }], boxes: [S(issue.rect)] }).hold(1300)
      .type(termFor('npx renderlint --ux', issue)).hold(4200);
    return sc;
  },
  // a hand-made modal: focus stays behind it and Escape does nothing
  async dialog() {
    const path = '/s/v-dlg-bad-div';
    const issue = await finding(path, 'dialog-focus');
    const page = await ctx.newPage();
    await page.goto(APP + path);
    await page.waitForLoadState('networkidle');
    const before = await png(page);
    const btn = await centerOf(page, 'text=Invite member');
    await page.click('text=Invite member');
    await sleep(300);
    const open = await png(page);
    const db = await page.locator('[role=dialog]').first().boundingBox();
    const dialogBox = { x: db.x, y: db.y, w: db.width, h: db.height };
    await page.close();
    const sc = scene('dialog-focus').set({ url: 'localhost:5393' + path, img: before });
    sc.hold(400).move(btn, 700).click().set({ img: open }).hold(700)
      .set({ chips: [{ t: 'focus: still on the page behind', tone: 'bad' }] }).hold(1000)
      .set({ key: 'Esc', chips: [{ t: 'focus: still on the page behind', tone: 'bad' }] }).hold(500)
      .set({ key: '', chips: [{ t: 'Escape: the dialog stays open', tone: 'bad' }], boxes: [S(dialogBox)] }).hold(1200)
      .type(termFor('npx renderlint --ux', issue)).hold(4200);
    return sc;
  },
};

const want = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(SCENES)) {
  if (want.length && !want.includes(name)) continue;
  await encode(await make());
}
await browser.close();

function STAGE_HTML() {
  return `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#e5e7eb;font:14px system-ui,sans-serif}
  .win{position:absolute;left:0;top:0;width:960px;height:610px;background:#fff;overflow:hidden}
  .bar{height:36px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:8px;padding:0 12px}
  .dot{width:11px;height:11px;border-radius:50%;background:#d1d5db}.url{margin-left:14px;flex:1;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:4px 10px;color:#4b5563;font-size:12.5px}
  .view{position:relative;width:960px;height:390px;overflow:hidden;background:#fff}.view img{display:block;width:960px;height:390px}
  .box{position:absolute;border:3px solid #e11d48;border-radius:4px;box-shadow:0 0 0 3px rgba(225,29,72,.18)}
  .chips{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
  .chip{font:600 13px system-ui;padding:6px 10px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.15)}
  .chip.info{background:#1e3a8a;color:#fff}.chip.bad{background:#be123c;color:#fff}
  .key{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);font:700 18px ui-monospace,monospace;background:#111827;color:#fff;padding:8px 16px;border-radius:8px;border-bottom:4px solid #4b5563}
  .cur{position:absolute;width:22px;height:22px;margin:-2px 0 0 -3px;pointer-events:none}
  .ring{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(37,99,235,.35)}
  .term{height:184px;background:#0b1020;color:#d1d5db;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px 14px;white-space:pre-wrap;overflow:hidden}
  .cmd{color:#e5e7eb}.rule{color:#facc15;font-weight:700}.msg{color:#e5e7eb;padding-left:8ch;text-indent:-8ch}.at{color:#67e8f9}
  </style><div class="win"><div class="bar"><span class="dot" style="background:#f87171"></span><span class="dot" style="background:#fbbf24"></span><span class="dot" style="background:#34d399"></span><span class="url" id="url"></span></div>
  <div class="view" id="view"><img id="img"><div id="boxes"></div><div class="chips" id="chips"></div><div id="key"></div><div id="cur"></div></div>
  <div class="term" id="term"></div></div>
  <script>
  const esc = (t) => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  window.render = (s) => {
    document.getElementById('url').textContent = s.url;
    const img = document.getElementById('img'); if (img.src !== s.img) img.src = s.img;
    document.getElementById('boxes').innerHTML = s.boxes.filter(Boolean).map((b) => '<div class="box" style="left:'+(b.x-4)+'px;top:'+(b.y-4)+'px;width:'+(b.w+8)+'px;height:'+(b.h+8)+'px"></div>').join('');
    document.getElementById('chips').innerHTML = s.chips.map((c) => '<div class="chip '+c.tone+'">'+esc(c.t)+'</div>').join('');
    document.getElementById('key').innerHTML = s.key ? '<div class="key">'+esc(s.key)+'</div>' : '';
    document.getElementById('cur').innerHTML = s.cursor ? (s.cursor.down ? '<div class="ring" style="left:'+s.cursor.x+'px;top:'+s.cursor.y+'px"></div>' : '') +
      '<svg class="cur" style="left:'+s.cursor.x+'px;top:'+s.cursor.y+'px" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>' : '';
    document.getElementById('term').innerHTML = s.term.map((l) => '<div class="'+l.c+'">'+esc(l.t)+'</div>').join('');
    return new Promise((r) => (img.complete ? requestAnimationFrame(() => r()) : (img.onload = () => requestAnimationFrame(() => r()))));
  };
  </script>`;
}
