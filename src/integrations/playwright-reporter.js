// Playwright reporter: merges what renderlint found in every worker into one report for the
// whole test run, prints it, writes .renderlint/report.json and report.md, and fails the run
// when errors were found (failOn: 'error' | 'warn' | 'never').
//
//   // playwright.config.ts
//   reporter: [['list'], ['@yitec/renderlint/playwright/reporter', { failOn: 'error' }]],
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, normalize } from '../config.js';
import { mergeIssues, formatPretty, formatMarkdown } from '../report.js';
import { runDir } from './playwright.js';

export default class RenderlintReporter {
  constructor(options = {}) {
    this.options = options;
  }

  async config() {
    if (!this._config) {
      const { config } = await loadConfig(this.rootDir || process.cwd());
      this._config = normalize({ ...config, ...this.options, rules: { ...config.rules, ...(this.options.rules || {}) } }, this.rootDir || process.cwd());
    }
    return this._config;
  }

  async onBegin(config) {
    // renderlint.config is read from where playwright runs, like the fixture does
    this.rootDir = process.cwd();
    const c = await this.config();
    // Leftovers of earlier runs (claims would make this run skip everything).
    const root = join(c.outputDir, 'playwright');
    if (existsSync(root)) for (const d of readdirSync(root)) if (/^run-\d+$/.test(d)) rmSync(join(root, d), { recursive: true, force: true });
    this.started = Date.now();
  }

  async onEnd() {
    const config = await this.config();
    const dir = runDir(config.outputDir, process.pid);
    const raw = [], pages = [], notes = [], widths = new Set();
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
        for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
          if (!line.trim()) continue;
          let e;
          try { e = JSON.parse(line); } catch { continue; }
          for (const w of e.viewports || []) widths.add(w);
          if (e.kind === 'live') {
            const u = new URL(e.url);
            pages.push({ path: u.pathname + u.search + u.hash + ((e.role || e.name) ? ` [${[e.role, e.name].filter(Boolean).join(': ')}]` : ''), url: e.url, mode: 'in place', test: e.test, ms: e.ms });
            raw.push(...e.issues);
          } else if (e.kind === 'replay') {
            for (const p of e.pages) { if (p.skipped) notes.push(`${p.path}: not replayed, ${p.skipped}`); else pages.push({ ...p, mode: 'replay' }); }
            raw.push(...e.issues);
          } else if (e.kind === 'replay-error') notes.push(`replay failed${e.role ? ' for ' + e.role : ''}: ${e.error}`);
        }
      }
    }
    if (!pages.length && !notes.length) return undefined; // the fixture wasn't used
    // the widths the fixture checked (its options may differ from renderlint.config)
    if (widths.size) config.viewports = Array.from(widths).sort((a, b) => a - b).map((width) => ({ width, height: 0 }));
    const issues = mergeIssues(raw, config);
    const schemes = Array.from(new Set(raw.map((i) => i.scheme).filter(Boolean)));
    const stats = {
      errors: issues.filter((i) => i.severity === 'error').reduce((n, i) => n + (i.count || 1), 0),
      warnings: issues.filter((i) => i.severity === 'warn').reduce((n, i) => n + (i.count || 1), 0),
      findings: issues.length, pages: pages.length, ms: Date.now() - (this.started || Date.now()), scanned: 0,
      schemes: schemes.length ? schemes : ['light'], suppressed: 0,
    };
    const failOn = this.options.failOn || config.failOn;
    const ok = failOn === 'never' ? true : failOn === 'warn' ? stats.errors + stats.warnings === 0 : stats.errors === 0;
    const result = { ok, issues, pages, stats, config };
    mkdirSync(config.outputDir, { recursive: true });
    writeFileSync(join(config.outputDir, 'report.json'), JSON.stringify({ ok, stats, pages, notes, issues }, null, 2));
    writeFileSync(join(config.outputDir, 'report.md'), formatMarkdown(result));
    const live = pages.filter((p) => p.mode === 'in place').length;
    const out = ['', `renderlint: ${live} state(s) checked in place at the end of tests, ${pages.length - live} visited page(s) replayed`];
    for (const n of notes) out.push('  ' + n);
    out.push(formatPretty(result, { cwd: process.cwd() }), '');
    process.stdout.write(out.join('\n') + '\n');
    if (!ok) return { status: 'failed' };
    return undefined;
  }

  printsToStdio() { return true; }
}
