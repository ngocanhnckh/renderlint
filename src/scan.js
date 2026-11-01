// Static source scan: catches emoji and placeholder copy in source files,
// including on routes the renderer never visits. Reports file:line.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { dialogAdvice } from './rules-meta.js';

const EXTS = new Set(['.html', '.htm', '.jsx', '.tsx', '.js', '.ts', '.mjs', '.vue', '.svelte', '.astro', '.mdx', '.hbs', '.ejs', '.njk', '.liquid', '.php', '.erb', '.css', '.scss']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', '.astro', 'coverage', '.renderlint', '.turbo', '.vercel', '.cache', 'vendor', '__tests__', '__mocks__', 'test', 'tests', 'e2e', 'cypress', 'playwright', '.storybook', 'storybook-static']);
const SKIP_FILE = /\.(test|spec|stories|story|d)\.[a-z]+$|\.min\.(js|css)$/;
const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[\u{1F1E6}-\u{1F1FF}]{2})/gu;
const DEFAULT_DIRS = ['src', 'app', 'pages', 'components', 'layouts', 'routes', 'views', 'templates', 'lib', 'ui'];

function* walk(dir, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(p, depth + 1); }
    else if (EXTS.has(extname(e.name)) && !SKIP_FILE.test(e.name)) yield p;
  }
}

// Native dialogs in source: window.alert/confirm/prompt(…) always; a bare alert(…)/confirm(…)/prompt(…) only
// when the file doesn't declare, import or destructure that name itself (a useConfirm() hook, a component's
// confirm() method, a prompt variable in an AI app). In HTML-like templates a bare call counts only inside
// <script> or an on…="" attribute: Angular (click)="confirm()" and Vue @click="confirm()" call the component.
const DIALOG_NAMES = ['alert', 'confirm', 'prompt'];
const DIALOG_GLOBAL = /\b(?:window|globalThis|self|top|parent)\s*\.\s*(alert|confirm|prompt)\s*\(/;
const TEMPLATE_EXTS = new Set(['.html', '.htm', '.php', '.erb', '.hbs', '.ejs', '.njk', '.liquid']);
const DIALOG_EXTS = new Set(['.html', '.htm', '.jsx', '.tsx', '.js', '.ts', '.mjs', '.vue', '.svelte', '.astro', '.hbs', '.ejs', '.njk', '.liquid', '.php', '.erb']);
function ownDialogNames(src) {
  const own = new Set();
  for (const name of DIALOG_NAMES) {
    const re = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 40), m.index), after = src.slice(m.index + name.length, m.index + name.length + 2000);
      const declared =
        /\b(?:function\*?|const|let|var|class|import|as|async|get|set)\s+$/.test(before) || // function confirm(), import confirm from, { x as confirm }
        /[{,(]\s*$/.test(before) && /^\s*(?:[,}):=]|\?:)/.test(after) || // { confirm } = useDialog(), (confirm) => …, import { confirm }
        /^\s*\??:(?!:)/.test(after) && !/\?\s*$/.test(before) || // confirm: () => …, an object key or a type
        /^\s*=(?![=>])/.test(after) || // confirm = …
        /(?:^|[\n;{}])\s*$/.test(before) && /^\(/.test(after) && /^\s*(?::[^=;{]*)?\{/.test(after.slice(matchParen(after) + 1)) && matchParen(after) > 0; // confirm(id) { … }: a method
      if (declared) { own.add(name); break; }
    }
  }
  return own;
}
function matchParen(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}
// The part of a template line that is script: all of it inside a <script> block, or what follows <script…> / precedes </script>.
function scriptPart(line, inScript) {
  let out = '', pos = 0, open = inScript;
  const re = /<script\b[^>]*>|<\/script\s*>/gi;
  let m;
  while ((m = re.exec(line))) {
    if (open) out += line.slice(pos, m.index) + ' ';
    open = m[0][1] !== '/';
    pos = m.index + m[0].length;
  }
  if (open) out += line.slice(pos);
  return { code: out, open };
}
const COMMENTED = /(?:^|[\s;{}])\/\/|\/\*(?!.*\*\/)/; // after a // or inside an unclosed /* on this line
function nativeDialog(line, own, template, inScript) {
  const g = DIALOG_GLOBAL.exec(line);
  if (g && !COMMENTED.test(line.slice(0, g.index))) return { name: g[1], col: g.index };
  let code = line;
  if (template) {
    const a = /\son[a-z]+\s*=\s*(["'])((?:(?!\1).)*)\1/i.exec(line);
    const m = a && /(?<![\w$.])(alert|confirm|prompt)\s*\(/.exec(a[2]);
    if (m) return { name: m[1], col: a.index + a[0].indexOf(a[2]) + m.index };
    code = inScript;
    if (!code.trim()) return null;
  }
  const re = /(?<![\w$.])(alert|confirm|prompt)\(/g;
  let m;
  while ((m = re.exec(code))) {
    if (own.has(m[1])) continue;
    const head = code.slice(0, m.index);
    if (/\b(?:function|def|fn)\s+$/.test(head) || COMMENTED.test(head)) continue;
    if ((head.match(/["'`]/g) || []).length % 2 && !/\son[a-z]+\s*=\s*["'][^"']*$/i.test(head)) continue; // inside a string ("Please confirm(…)")
    return { name: m[1], col: template ? Math.max(0, line.indexOf(m[0])) : m.index };
  }
  return null;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--') || t.startsWith('#') && !t.startsWith('#{');
}

// WordPress themes and plugins keep templates at the top level and in these folders.
const WP_DIRS = ['template-parts', 'parts', 'patterns', 'templates', 'page-templates', 'inc', 'includes', 'blocks', 'partials', 'woocommerce', 'elementor', 'widgets'];

export function scanSources({ cwd = process.cwd(), dirs, rules = {}, wordpress = false } = {}) {
  const defaults = wordpress ? [...DEFAULT_DIRS, ...WP_DIRS] : DEFAULT_DIRS;
  const roots = (dirs && dirs.length ? dirs : Array.from(new Set(defaults)).filter((d) => existsSync(join(cwd, d)))).map((d) => join(cwd, d));
  // plain-HTML projects: scan top-level html files too (and a theme's or plugin's top-level PHP templates)
  for (const f of readdirSync(cwd)) if (/\.html?$/.test(f) || (wordpress && /\.php$/.test(f))) roots.push(join(cwd, f));
  const issues = [];
  const seen = new Set();
  for (const root of roots) {
    const files = statSync(root).isDirectory() ? walk(root) : [root];
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      let src;
      try { src = readFileSync(file, 'utf8'); } catch { continue; }
      if (src.length > 2_000_000 || /renderlint-ignore-file/.test(src)) continue;
      const lines = src.split('\n');
      const ext = extname(file);
      const dialogs = rules['native-dialog'] !== 'off' && DIALOG_EXTS.has(ext) && /(?:alert|confirm|prompt)\s*\(/.test(src);
      const own = dialogs ? ownDialogNames(src) : null;
      const template = TEMPLATE_EXTS.has(ext);
      let inScript = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let script = '';
        if (template) ({ code: script, open: inScript } = scriptPart(line, inScript));
        if (line.length > 3000) continue;
        const prev = i > 0 ? lines[i - 1] : '';
        const ignored = (rule) => {
          for (const l of [line, prev]) {
            const m = /renderlint-ignore(?!-file)(?:[ :]+([\w ,-]*[\w-]))?/.exec(l);
            if (!m) continue;
            if (!m[1]) return true;
            const list = m[1].split(/[\s,]+/);
            if (list.includes(rule) || list.includes('all')) return true;
          }
          return false;
        };
        if (isCommentLine(line) || /console\.(log|warn|error|info|debug)\(/.test(line)) continue;
        if (rules.emoji !== 'off') {
          const m = line.match(EMOJI_RE);
          if (m && !ignored('emoji') && !/data-renderlint-ignore=["'][^"']*emoji/.test(line)) {
            issues.push({
              rule: 'emoji', file: relative(cwd, file), line: i + 1, column: line.search(EMOJI_RE) + 1,
              message: 'Emoji in UI source: ' + Array.from(new Set(m)).slice(0, 6).join(' ') + '. Use an SVG icon from an icon set instead.',
              text: line.trim().slice(0, 100),
            });
          }
        }
        if (dialogs && !ignored('native-dialog')) {
          const d = nativeDialog(line, own, template, script);
          if (d) issues.push({ rule: 'native-dialog', file: relative(cwd, file), line: i + 1, column: d.col + 1, message: `${d.name}() opens the browser's native dialog. ${dialogAdvice(d.name)}`, text: line.trim().slice(0, 100) });
        }
        if (rules['placeholder-text'] !== 'off' && /\blorem ipsum\b/i.test(line) && !ignored('placeholder-text')) {
          issues.push({ rule: 'placeholder-text', severity: 'warn', file: relative(cwd, file), line: i + 1, column: line.search(/lorem ipsum/i) + 1, message: 'Placeholder "lorem ipsum" copy in source.', text: line.trim().slice(0, 100) });
        }
      }
    }
  }
  return issues;
}
