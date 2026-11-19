// Runs renderlint on each before/after pair in examples-src/ and stores its real output
// (report, terminal text, annotated screenshots) in content/captures/<pair>/.
// Nothing here is edited by hand: re-run `npm run capture` to regenerate.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const repo = path.resolve(site, '..');
const src = path.join(site, 'examples-src');
const outRoot = path.join(site, 'content', 'captures');
const tmp = path.join(site, '.renderlint');
const cli = path.join(repo, 'bin', 'renderlint.js');

// pair → which annotated screenshot shows the defect best, and the width for the "after" capture
const PAIRS = {
  overflow: { shot: '@375.png', width: 375 },
  contrast: { shot: '@768.png', width: 768 },
  unreachable: { shot: '@1280.png', width: 1280 },
  menu: { shot: '@768-menu1.png', extra: '@768-menu2.png', width: 768, open: '[aria-controls=m2]' },
  loading: { shot: '@375-loading.png', width: 375 },
  dialog: { shot: null, width: 768, open: '#del' },
  forms: { shot: '@768.png', width: 768 },
};

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(file, out) {
  fs.rmSync(out, { recursive: true, force: true });
  let text;
  try {
    text = execFileSync('node', [cli, file, '--no-crawl', '--format', 'pretty', '--out', out], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (e) {
    text = e.stdout; // exit code 1 when errors are found
  }
  const rel = path.relative(repo, out);
  text = strip(text).split(rel).join('.renderlint').split(out).join('.renderlint').trim();
  return { text, report: JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')) };
}

// The "after" pages are opened over HTTP (fetch() doesn't work on file:// URLs).
const server = http.createServer((req, res) => {
  const f = path.join(src, path.basename(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': f.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const summary = {};
for (const [name, opt] of Object.entries(PAIRS)) {
  const dest = path.join(outRoot, name);
  fs.mkdirSync(dest, { recursive: true });
  const entry = {};
  for (const side of ['before', 'after']) {
    const file = path.join(src, `${name}-${side}.html`);
    const out = path.join(tmp, `${name}-${side}`);
    const { text, report } = run(file, out);
    fs.writeFileSync(path.join(dest, `${side}.txt`), text + '\n');
    const issues = report.issues.map((i) => ({
      rule: i.rule, severity: i.severity, message: i.message, selector: i.selector, text: i.text,
      viewports: i.viewports, fix: i.fix,
    }));
    entry[side] = { errors: report.stats.errors, warnings: report.stats.warnings, issues };
    if (side === 'before' && opt.shot) {
      const screens = fs.readdirSync(path.join(out, 'screens'));
      const pick = (suffix) => screens.find((f) => f.endsWith(suffix));
      fs.copyFileSync(path.join(out, 'screens', pick(opt.shot)), path.join(dest, 'before.png'));
      if (opt.extra) fs.copyFileSync(path.join(out, 'screens', pick(opt.extra)), path.join(dest, 'before-2.png'));
    }
    if (side === 'after') {
      // renderlint saves no screenshot when it finds nothing, so capture the fixed page as rendered.
      const page = await browser.newPage({ viewport: { width: opt.width, height: 800 }, deviceScaleFactor: 1 });
      await page.goto(`${origin}/${path.basename(file)}`, { waitUntil: 'networkidle' });
      if (opt.open) { await page.click(opt.open); await page.waitForTimeout(200); }
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(dest, 'after.png'), fullPage: opt.width !== 1280 && !opt.open });
      await page.close();
    }
  }
  // Drop the empty viewport below the content (keep a 24px margin), so the pairs line up.
  for (const f of fs.readdirSync(dest).filter((f) => f.endsWith('.png'))) {
    const file = path.join(dest, f);
    const buf = fs.readFileSync(file);
    const meta = await sharp(buf).metadata();
    const { info } = await sharp(buf).trim({ threshold: 6 }).toBuffer({ resolveWithObject: true });
    const bottom = Math.min(meta.height, -(info.trimOffsetTop || 0) + info.height + 24);
    if (bottom < meta.height - 8) await sharp(buf).extract({ left: 0, top: 0, width: meta.width, height: bottom }).png().toFile(file);
  }
  fs.writeFileSync(path.join(dest, 'summary.json'), JSON.stringify(entry, null, 2) + '\n');
  summary[name] = { before: `${entry.before.errors} errors, ${entry.before.warnings} warnings`, after: `${entry.after.errors} errors, ${entry.after.warnings} warnings` };
}
await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.table(summary);
