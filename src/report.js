// Merges raw findings and formats them for humans and coding agents.
import { relative } from 'node:path';
import { RULES, IGNORE_HELP } from './rules-meta.js';
import { effectiveSeverity, groupKey } from './runner.js';

export function mergeIssues(raw, config) {
  const groups = new Map();
  for (const i of raw) {
    const severity = effectiveSeverity(i, config);
    if (severity === 'off') continue;
    if ((config.ignore || []).some((ig) => !ig.selector && (!ig.rule || ig.rule === i.rule) && (!ig.page || globLike(ig.page, i.page || '')) && (!ig.message || new RegExp(ig.message).test(i.message)))) continue;
    const key = groupKey(i);
    let g = groups.get(key);
    if (!g) {
      g = { ...i, severity, viewports: [], pages: [], markers: [], schemes: [] };
      delete g.viewport; delete g.page; delete g.url; delete g.marker; delete g.scheme;
      groups.set(key, g);
    }
    if (i.scheme && !g.schemes.includes(i.scheme)) g.schemes.push(i.scheme);
    if (i.viewport && !g.viewports.includes(i.viewport)) g.viewports.push(i.viewport);
    if (i.page && !g.pages.includes(i.page)) g.pages.push(i.page);
    if (i.marker && i.screenshot) g.markers.push({ screenshot: i.screenshot, n: i.marker, viewport: i.viewport });
  }
  // Collapse repeats of the same defect in list items/cards (selectors that
  // differ only by :nth-of-type) into one finding with a count.
  const similar = new Map();
  for (const g of groups.values()) {
    const shape = (sel) => (sel || '').replace(/:nth-of-type\(\d+\)/g, '');
    const msgShape = g.message.replace(/"[^"]*"/g, '""').replace(/\d+(\.\d+)?/g, '#');
    const key = g.selector ? [g.rule, shape(g.selector), shape(g.related && g.related.selector), msgShape, g.schemes.join()].join('|') : 'u|' + similar.size;
    const first = similar.get(key);
    if (!first) { g.count = 1; similar.set(key, g); continue; }
    first.count++;
    for (const v of g.viewports) if (!first.viewports.includes(v)) first.viewports.push(v);
    for (const p of g.pages) if (!first.pages.includes(p)) first.pages.push(p);
    (first.similar = first.similar || []).push(g.selector);
  }
  const order = { error: 0, warn: 1 };
  return Array.from(similar.values()).sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule));
}

function globLike(p, s) { return new RegExp('^' + p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(s); }

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c('31', s), yellow = (s) => c('33', s), dim = (s) => c('2', s), bold = (s) => c('1', s), cyan = (s) => c('36', s), green = (s) => c('32', s);

// Where to make the fix in the Elementor editor, shown when a finding comes from an Elementor widget.
const RESPONSIVE = 'switch the editor to Mobile/Tablet view and set a smaller size there (Style > Typography > Size), replace fixed px widths with % or "Full Width" (Advanced > Layout > Width), and set the container\'s Direction to Column on mobile.';
const ELEMENTOR_FIX = {
  'text-overflow': RESPONSIVE + ' Long words: Advanced > Custom CSS `selector { overflow-wrap: anywhere; hyphens: auto; }` (Pro), or the site\'s custom CSS.',
  'text-clipped': RESPONSIVE,
  'text-crowding': RESPONSIVE,
  'fragile-layout': RESPONSIVE,
  'viewport-overflow': RESPONSIVE + ' Also check negative margins and Advanced > Position on each device.',
  'content-overflow': 'check the widget\'s Advanced > Layout width and negative margins on each device, and Advanced > Position (absolute) offsets.',
  'element-overlap': 'check negative margins, Advanced > Position (absolute) and Z-index on each device, or use container Gap instead of margins.',
  'text-overlap': 'check negative margins and Advanced > Position on each device; on mobile set the container\'s Direction to Column.',
  contrast: 'change the widget\'s Style > Text Color, or fix the Global Colors in Site Settings once (Elementor\'s default Primary #6EC1E4 and Text #7A7A7A both fail on white).',
  'image-distortion': 'in the Image widget set only Width and leave Height on auto, or set Object Fit to Cover.',
  emoji: 'use an Icon, Icon Box or Icon List widget (Font Awesome or an uploaded SVG) instead of emoji in the text.',
  'placeholder-text': 'edit the widget and replace the default text.',
  'dead-link': 'set the button\'s Link field, or remove the button.',
  'font-size-min': 'raise Style > Typography > Size for Mobile.',
  'tap-target': 'increase the button\'s Padding (Style) or Size for Mobile.',
  'icon-misaligned': 'set Vertical Align / Icon Position in the widget, or Align Items: Center on the container.',
};

function sourceStr(src) {
  if (!src) return '';
  if (src.elementor) {
    const e = src.elementor;
    return `Elementor ${e.type} ${e.id}` + (e.doc ? ` in ${e.docType} #${e.doc} — edit: ${e.edit}` : '');
  }
  const file = src.file ? src.file.replace(/^.*?\/(src|app|pages|components)\//, '$1/') : '';
  const block = src.block && `block ${src.block}` + (src.templatePart ? ` in the ${src.templatePart} template part` : '');
  return [src.component, file && (file + (src.line ? ':' + src.line : '')), !src.component && !file && block].filter(Boolean).join(' — ');
}

// Route coverage: one line, then every route that was not checked, with the reason.
export function formatCoverage(cov, { max = 30 } = {}) {
  if (!cov) return [];
  const lines = [];
  const bad = cov.list.filter((r) => r.status !== 'checked' && r.status !== 'excluded');
  lines.push((bad.length ? yellow('◐ ') : green('✔ ')) + bold('Coverage') + ' ' + cov.line + dim(` (${cov.percent}% of routes; up to ${cov.perRoute} instance(s) per route)`));
  const label = { 'needs-auth': 'needs sign-in', 'needs-role': 'needs a role', 'needs-params': 'needs param values', redirected: 'redirects', unreachable: 'not reachable', error: 'failed', 'not-checked': 'not checked' };
  for (const r of bad.slice(0, max)) lines.push(`  ${yellow(label[r.status] || r.status)} ${r.pattern}${r.file ? dim('  ' + r.file) : r.inferred ? dim('  (seen, no route in the source)') : ''}${r.reason ? dim(' — ' + r.reason) : ''}`);
  if (bad.length > max) lines.push(dim(`  … ${bad.length - max} more in .renderlint/coverage.json`));
  for (const g of cov.gate || []) lines.push(red('  ✖ ' + g));
  return lines;
}

// Which page was checked as which role, and which ones the app didn't show.
function roleCoverageLines(c) {
  const out = [];
  const rows = (c.pages || []).slice().sort((a, b) => a.route.localeCompare(b.route));
  const roles = c.roles.length ? c.roles : ['default'];
  if (rows.length && (c.roles.length || rows.some((r) => Object.values(r.roles).some((v) => v !== 'checked')))) {
    const w = Math.min(36, Math.max(5, ...rows.map((r) => r.route.length)));
    out.push(dim(`${c.roles.length ? 'Pages by role' : 'Pages'}${c.framework ? ` (routes from the ${c.framework} router)` : ''}:`));
    const cw = roles.map((name) => Math.min(48, Math.max(name.length, 7, ...rows.map((r) => (r.roles[name] || '').length))));
    if (c.roles.length) out.push(dim('  ' + 'route'.padEnd(w) + '  ' + roles.map((r, i) => r.padEnd(cw[i])).join('  ')));
    for (const r of rows) {
      const cells = roles.map((name, i) => {
        const v = r.roles[name], t = (v || '—').slice(0, cw[i]).padEnd(cw[i]);
        return v === undefined ? dim(t) : v === 'checked' ? green(t) : /\((expected|ordinary redirect)\)$/.test(v) ? dim(t) : yellow(t);
      });
      out.push('  ' + r.route.slice(0, w).padEnd(w) + '  ' + cells.join('  '));
    }
  }
  const skipped = c.skipped || [];
  for (const s of skipped.slice(0, 10)) out.push(yellow('  not checked: ') + s.route + dim(` (${s.reason})`));
  if (skipped.length > 10) out.push(dim(`  … ${skipped.length - 10} more not checked (roleCoverage.skipped in report.json)`));
  if (c.overLimit) out.push(yellow(`  ${c.overLimit.count} more page(s) found but not checked`) + dim(` (maxPages ${c.overLimit.maxPages}${c.roles.length ? ' per role' : ''}): ${c.overLimit.routes.join(', ')}${c.overLimit.count > c.overLimit.routes.length ? ', …' : ''}. Raise "maxPages" to check them.`));
  if (out.length) out.push('');
  return out;
}

export function formatPretty(result, { maxPerRule = 12, cwd = process.cwd() } = {}) {
  const { issues, pages, config, stats } = result;
  const lines = [];
  const vps = config.viewports.map((v) => v.width + 'px').join(', ');
  lines.push(bold('renderlint') + dim(` — ${pages.length} page(s) × viewports ${vps}${stats.schemes.length > 1 ? ' × ' + stats.schemes.join('/') : ''}${stats.scanned ? ` + source scan (${stats.scanned} findings)` : ''}`));
  if (result.coverage) lines.push(...formatCoverage(result.coverage));
  if (result.roleCoverage) lines.push(...roleCoverageLines(result.roleCoverage));
  if (!issues.length) {
    lines.push(green('✔ No UI defects found.'));
    return lines.join('\n');
  }
  lines.push('');
  const byRule = new Map();
  for (const i of issues) { if (!byRule.has(i.rule)) byRule.set(i.rule, []); byRule.get(i.rule).push(i); }
  let n = 0;
  for (const [rule, list] of byRule) {
    const sev = list[0].severity;
    lines.push((sev === 'error' ? red('✖ ') : yellow('⚠ ')) + bold(rule) + dim(` (${list.length})  `) + dim(RULES[rule] ? RULES[rule].summary : ''));
    for (const i of list.slice(0, maxPerRule)) {
      n++;
      const tag = i.severity === 'error' ? red('error') : yellow('warn ');
      lines.push(`  ${tag} ${i.message}` + (i.count > 1 ? bold(` (×${i.count} similar elements)`) : ''));
      if (i.file) {
        lines.push(dim('        at ') + cyan(`${i.file}:${i.line}:${i.column}`) + dim('  ' + (i.text || '')));
      } else if (i.selector) {
        lines.push(dim('        at ') + cyan(i.selector) + (i.text ? dim(`  "${i.text}"`) : ''));
        if (i.related && i.related.selector !== i.selector) lines.push(dim('      with ') + i.related.selector + (i.related.text ? dim(`  "${i.related.text.slice(0, 50)}"`) : ''));
        const src = sourceStr(i.source);
        if (src) lines.push(dim('        in ') + src);
      }
      const where = [];
      if (i.pages.length) where.push('page ' + i.pages.slice(0, 4).join(', ') + (i.pages.length > 4 ? ` +${i.pages.length - 4}` : ''));
      if (i.viewports.length && i.viewports.length < config.viewports.length) where.push('at ' + i.viewports.sort((a, b) => a - b).map((v) => v + 'px').join(', '));
      else if (i.viewports.length) where.push('all viewports');
      if (i.schemes && i.schemes.length === 1 && i.schemes[0] === 'dark') where.push('dark mode only');
      if (i.markers.length) where.push('see ' + relative(cwd, i.markers[0].screenshot) + ' #' + i.markers[0].n);
      if (where.length) lines.push(dim('        ' + where.join(' · ')));
      if (i.details && i.details.suggestion) lines.push(dim('       fix ') + `use ${i.details.suggestion} (currently ${i.details.fg} on ${i.details.bg})`);
    }
    if (list.length > maxPerRule) lines.push(dim(`  … ${list.length - maxPerRule} more ${rule} finding(s) in .renderlint/report.json`));
    lines.push('');
  }
  lines.push(bold('How to fix'));
  for (const [rule, list] of byRule) {
    if (!RULES[rule]) continue;
    lines.push(`  ${bold(rule)}: ${RULES[rule].fix}`);
    if (ELEMENTOR_FIX[rule] && list.some((i) => i.source && i.source.elementor)) lines.push(`    ${dim('In Elementor:')} ${ELEMENTOR_FIX[rule]}`);
  }
  lines.push('');
  lines.push(dim(IGNORE_HELP));
  const e = stats.errors, w = stats.warnings;
  lines.push('');
  lines.push((e ? red(bold(`✖ ${e} error(s)`)) : green('✔ 0 errors')) + ', ' + (w ? yellow(`${w} warning(s)`) : '0 warnings') +
    (stats.suppressed ? dim(` · ${stats.suppressed} element(s) marked data-renderlint-ignore`) : '') +
    dim(' · screenshots in ' + relative(cwd, config.outputDir) + '/screens'));
  return lines.join('\n');
}

export function formatMarkdown(result) {
  const { issues, stats } = result;
  const out = ['# renderlint report', '', `**${stats.errors} error(s), ${stats.warnings} warning(s)** across ${result.pages.length} page(s).`, ''];
  if (result.coverage) {
    const cov = result.coverage;
    out.push(`**Coverage:** ${cov.line} (${cov.percent}% of routes).`, '', '| Route | Status | Instances | Checked | File |', '|---|---|---|---|---|');
    for (const r of cov.list) out.push(`| \`${r.pattern}\` | ${r.status}${r.reason ? ': ' + r.reason.replace(/\|/g, '\\|') : ''} | ${r.instances} | ${(r.checked || []).length} | ${r.file ? '`' + r.file + '`' : ''} |`);
    for (const g of cov.gate || []) out.push('', `**Coverage gate failed:** ${g}`);
    out.push('');
  }
  for (const i of issues) {
    out.push(`- **${i.severity}** \`${i.rule}\` — ${i.message}`);
    if (i.file) out.push(`  - at \`${i.file}:${i.line}\``);
    if (i.selector) out.push(`  - element \`${i.selector}\`${i.text ? ` "${i.text}"` : ''}${i.source ? ` — ${sourceStr(i.source)}` : ''}`);
    if (i.pages.length) out.push(`  - pages ${i.pages.join(', ')} · viewports ${i.viewports.join(', ')}${i.schemes && i.schemes.length === 1 && i.schemes[0] === 'dark' ? ' · dark mode only' : ''}`);
    if (i.markers.length) out.push(`  - screenshot \`${i.markers[0].screenshot}\` marker #${i.markers[0].n}`);
  }
  return out.join('\n');
}

export function formatGithub(result) {
  return result.issues.map((i) => {
    const level = i.severity === 'error' ? 'error' : 'warning';
    const loc = i.file ? `file=${i.file},line=${i.line},col=${i.column},` : (i.source && i.source.file && !/^https?:/.test(i.source.file) ? `file=${i.source.file.replace(/^\//, '')},line=${i.source.line || 1},` : '');
    return `::${level} ${loc}title=renderlint ${i.rule}::${i.message}${i.selector ? ` (${i.selector}${i.pages.length ? ' on ' + i.pages.join(', ') : ''})` : ''}`;
  }).join('\n');
}
