// Concatenates the in-page analyzer sources into one self-contained script.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FILES = ['core.js', 'rules/layout.js', 'rules/overlap.js', 'rules/content.js', 'rules/a11y.js', 'rules/forms.js', 'rules/popups.js', 'rules/loading.js', 'rules/ux.js', 'solid-bg.js', 'run.js'];

let cached;
export function analyzerSource() {
  if (cached) return cached;
  const body = FILES.map((f) => '// ---- ' + f + '\n' + readFileSync(join(here, f), 'utf8')).join('\n');
  cached = '(function () {\n"use strict";\nif (window.__renderlint) return;\nconst RL = {};\n' + body + '\nwindow.__renderlint = RL;\n})();\n';
  return cached;
}
