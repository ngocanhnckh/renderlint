// Native browser dialogs (alert, confirm, prompt): on load, behind a click, and in source.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { scanSources } from '../src/scan.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title>
<style>body{font-family:sans-serif;margin:0;padding:16px;color:#111;background:#fff} button{font:inherit;padding:10px 16px}</style></head><body>
<p id="status">3 projects</p>
<button id="del" type="button">Delete project</button>
<button id="ok" type="button">Archive project</button>
<script>
  function deleteProject() { if (confirm('Delete this project? This cannot be undone.')) document.getElementById('status').textContent = 'DELETED'; }
  document.getElementById('del').addEventListener('click', deleteProject);
  // the app's own confirm(): not a native dialog
  window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
</script></body></html>`;

test('a confirm() behind a click: flagged with where it was called, answered Cancel', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-dlg-'));
  const file = join(dir, 'index.html');
  writeFileSync(file, PAGE);
  const res = await check({
    targets: [file], browser, scan: false, configFile: false, cwd: dir,
    config: { crawl: false, screenshots: false, outputDir: join(dir, 'out'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false,
      states: [{ name: 'delete', click: '#del', run: async (page) => { if ((await page.textContent('#status')) === 'DELETED') throw new Error('confirm was accepted'); } }] },
  });
  const hits = res.issues.filter((i) => i.rule === 'native-dialog');
  assert.equal(hits.length, 1, JSON.stringify(res.issues, null, 1));
  assert.equal(hits[0].severity, 'error');
  assert.match(hits[0].message, /confirm\(\) "Delete this project\? This cannot be undone\." opened the browser.s native dialog/);
  assert.match(hits[0].message, /called at .*index\.html:\d+:\d+\. Replace it with the app.s own confirmation modal/);
  assert.ok(!res.issues.some((i) => i.rule === 'page-error'), JSON.stringify(res.issues, null, 1));
});

test('"native-dialog": "off" lets dialogs pass', async () => {
  const res = await check({
    targets: [join(here, 'fixtures/defects/native-dialog.html')], browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
    config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, rules: { 'native-dialog': 'off' } },
  });
  assert.ok(!res.issues.some((i) => i.rule === 'native-dialog'));
});

test('source scan: native calls are flagged; hooks, methods, template bindings and text are not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-dlg-'));
  mkdirSync(join(dir, 'src'));
  const put = (f, lines) => writeFileSync(join(dir, 'src', f), lines.join('\n'));
  put('Flagged.jsx', [
    "const onSave = async () => { await api.save(); alert('Saved!'); };",
    "const del = <button onClick={() => { if (window.confirm('Delete?')) remove(); }}>Delete</button>;",
    "const name = prompt('Your name?');",
    "// renderlint-ignore native-dialog -- kiosk mode",
    "alert('ok');",
  ]);
  put('Clean.tsx', [
    "import { useConfirm } from './dialogs';",
    "export function Delete({ prompt }: { prompt: string }) {",
    "  const confirm = useConfirm();",
    "  const onDelete = async () => { if (await confirm({ title: 'Delete?' })) remove(); };",
    "  // alert('old code');",
    "  const msg = \"Please confirm(again)\";",
    "  return <div role=\"alert\"><p>Please confirm your email</p>{prompt}</div>;",
    "}",
  ]);
  put('dialog.component.ts', [
    "export class DeleteDialogComponent {",
    "  confirm(): void { this.ref.close(true); }",
    "  async prompt(id: string) { return this.dialog.open(PromptComponent, { data: id }); }",
    "  run() { this.confirm(); this.dialog.confirm('y'); }",
    "}",
  ]);
  put('Hook.js', ["const { confirm, alert } = useDialogs();", "export const go = async () => { if (await confirm('Discard?')) alert('Done'); };"]);
  put('dialog.component.html', [
    '<button (click)="confirm()">Delete</button>',
    '<button onclick="return confirm(\'Remove item?\')">Plain</button>',
    '<p>Click confirm() to continue</p>',
    "<script>document.forms[0].onsubmit = () => alert('Thanks');</script>",
  ]);
  put('Thing.vue', ['<template><button @click="confirm()">Delete</button></template>', '<script setup>', 'const { confirm } = useConfirmDialog();', '</script>']);
  const found = scanSources({ cwd: dir }).filter((i) => i.rule === 'native-dialog').map((i) => `${i.file.replace(/^src\//, '')}:${i.line}`).sort();
  assert.deepEqual(found, ['Flagged.jsx:1', 'Flagged.jsx:2', 'Flagged.jsx:3', 'dialog.component.html:2', 'dialog.component.html:4']);
});
