// Runs renderlint on the benchmark pages and prints which rules each one triggered, next to its label.
//   (cd app && npm install && npm run dev)   then:   node bench/loading/run.mjs bench/loading/app/scenarios.json [--ux] [--vp 375] [--only a,b]
import { check } from '../../src/index.js';
import { launchBrowser } from '../../src/browser.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const OUT = join(tmpdir(), 'renderlint-bench');
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const ux = args.includes('--ux');
const vpw = args.includes('--vp') ? +args[args.indexOf('--vp') + 1] : 1280;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const list = JSON.parse(readFileSync(args[0], 'utf8')).filter((s) => !only || only.includes(s.id));
const browser = await launchBrowser();
const RULES = ['loading-state', 'action-feedback', 'ui-freeze', 'error-feedback', 'double-submit', 'dead-control', 'slow-render', 'layout-shift', 'empty-state', 'dialog-focus', 'back-navigation'];
const out = [];
for (const s of list) {
  const t = Date.now();
  const res = await check({ targets: ['http://localhost:5393' + (s.url || '/s/' + s.id)], browser, scan: false, configFile: false, cwd: OUT,
    config: { crawl: false, routes: false, screenshots: true, outputDir: join(OUT, s.id), viewports: [vpw], colorSchemes: ['light'], sweep: false, stress: false, ux } });
  const found = res.issues.filter((i) => RULES.includes(i.rule));
  const rec = { id: s.id, kind: s.kind, expect: s.expect, ms: Date.now() - t, rules: [...new Set(found.map((i) => i.rule))], msgs: found.map((i) => `${i.rule}: ${i.message.slice(0, 160)}`) };
  out.push(rec);
  console.log(`${s.id.padEnd(28)} ${(s.rule || '').padEnd(16)} ${s.expect.padEnd(5)} ${(rec.rules.join(',') || '-').padEnd(40)} ${rec.ms}ms`);
}
await browser.close();
console.log(JSON.stringify(out.filter((r) => r.msgs.length).slice(0, 3).map((r) => r.msgs), null, 1));
