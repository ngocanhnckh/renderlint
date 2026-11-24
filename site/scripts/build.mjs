// Static site build: node scripts/build.mjs → dist/
// Pages are plain HTML strings, pre-rendered; the only client JS is a few lines for copy buttons and the hero clip.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Marked } from 'marked';
import * as icons from 'simple-icons';
import { RULES } from '../../src/rules-meta.js';
import { site, repo, dist, SITE, REPO, NPM, PKG, INSTALL, AUTHOR, VERSION, esc, slugify, frontMatter, img, image, terminal, write } from './lib.mjs';
import { home, FAQ } from './pages/home.mjs';
import { getStarted } from './pages/get-started.mjs';
import { examples } from './pages/examples.mjs';
import { ogImages } from './og.mjs';

const t0 = Date.now();
// Clean only what this script writes (keep cached images between runs).
for (const f of fs.existsSync(dist) ? fs.readdirSync(dist) : []) fs.rmSync(path.join(dist, f), { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// ---- assets -----------------------------------------------------------------------------------
const nm = path.join(site, 'node_modules');
const fonts = {
  'instrument-serif-400.woff2': '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2',
  'instrument-serif-400-italic.woff2': '@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2',
  'inter-var.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'jetbrains-mono-400.woff2': '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
};
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
for (const [to, from] of Object.entries(fonts)) fs.copyFileSync(path.join(nm, from), path.join(dist, 'fonts', to));
fs.cpSync(path.join(site, 'static'), dist, { recursive: true, filter: (f) => !(f.includes('/og/') && f.endsWith('.png')) });

const css = fs.readFileSync(path.join(site, 'src', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s*([{};,])\s*/g, '$1').replace(/:\s+/g, ':').replace(/;}/g, '}');
const js = fs.readFileSync(path.join(site, 'src', 'main.js'), 'utf8');

// ---- icons ------------------------------------------------------------------------------------
export const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  github: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${icons.siGithub.path}"/></svg>`,
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><rect x="8" y="9" width="8" height="6" rx="1" stroke="#ec6a42"/></svg>',
};
export const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="#0c0c0c"/><rect x="8" y="10.5" width="16" height="11" rx="2.2" fill="none" stroke="#ec6a42" stroke-width="2.6"/><path d="M8 7h9" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';

// "Works with": only what README/docs say renderlint supports. Simple Icons (CC0) in each brand's colour; Playwright has no mark there.
// Stars and weekly npm downloads come from the GitHub and npm APIs at build time (cached in content/stats.json for a day; the cache is used when offline).
const brand = (si, color) => icons[si] ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path${color ? ` style="fill:${color}"` : ''} d="${icons[si].path}"/></svg>` : '';
const STATS_FILE = path.join(site, 'content', 'stats.json');
const statsCache = fs.existsSync(STATS_FILE) ? JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) : { fetched: 0, repos: {}, npm: {} };
const fresh = Date.now() - statsCache.fetched < 24 * 3600e3;
async function getJson(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'renderlint-site-build', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function stats(list) {
  const missing = list.some((x) => (x.repo && !statsCache.repos[x.repo]) || (x.npm && !statsCache.npm[x.npm]));
  if (!fresh || missing) {
    let got = 0;
    await Promise.all(list.map(async (x) => {
      if (x.repo) { const j = await getJson(`https://api.github.com/repos/${x.repo}`); if (j?.stargazers_count) { statsCache.repos[x.repo] = j.stargazers_count; got++; } }
      if (x.npm) { const j = await getJson(`https://api.npmjs.org/downloads/point/last-week/${x.npm}`); if (j?.downloads) { statsCache.npm[x.npm] = j.downloads; got++; } }
    }));
    if (got) { statsCache.fetched = Date.now(); statsCache.date = new Date().toISOString().slice(0, 10); }
  }
  return list.map((x) => ({ ...x, stars: statsCache.repos[x.repo], downloads: statsCache.npm[x.npm] }));
}
const compact = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n);
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M6.5 11 12 16.5 17.5 11M5 20h14"/></svg>';
function chip(x, hidden) {
  const nums = [x.stars && `<span class="n">${STAR}${compact(x.stars)}<span class="sr"> GitHub stars</span></span>`, x.downloads && `<span class="n">${DOWN}${compact(x.downloads)}/wk<span class="sr"> npm downloads a week</span></span>`].filter(Boolean).join('');
  const inner = `<span class="mk">${x.mark}</span><span class="tx"><b>${esc(x.name)}</b><span class="nums">${nums || `<span class="n">${esc(x.note || '')}</span>`}</span></span>`;
  return `<li style="--c:${x.color}">${x.href ? `<a class="card" href="${x.href}" rel="noopener"${hidden ? ' tabindex="-1"' : ''}>${inner}</a>` : `<span class="card">${inner}</span>`}</li>`;
}
// An endless strip: one real list, then copies for the loop (hidden from assistive tech and the keyboard).
function marquee(items, { min = 10, reverse = false, seconds = 40 } = {}) {
  const reps = Math.max(1, Math.ceil(min / items.length));
  const set = (hidden) => `<ul class="set"${hidden ? ' aria-hidden="true"' : ''}>${Array.from({ length: reps }, (_, i) => items.map((x) => chip(x, hidden || i > 0).replace('<li ', i > 0 ? '<li class="dup" aria-hidden="true" ' : '<li ')).join('')).join('')}</ul>`;
  return `<div class="marquee${reverse ? ' rev' : ''}" style="--t:${seconds}s" data-renderlint-ignore="text-clipped content-overflow viewport-overflow obscured-content element-overlap" data-renderlint-reason="endless logo strip: chips scroll through a clipped window on purpose"><div class="track">${set(false)}${set(true)}</div></div>`;
}
const WW = await stats([
  ['Next.js', 'siNextdotjs', '#000000', 'vercel/next.js', 'next'], ['React', 'siReact', '#149eca', 'facebook/react', 'react'], ['Vue', 'siVuedotjs', '#42b883', 'vuejs/core', 'vue'],
  ['Nuxt', 'siNuxt', '#00DC82', 'nuxt/nuxt', 'nuxt'], ['Svelte / SvelteKit', 'siSvelte', '#FF3E00', 'sveltejs/svelte', 'svelte'], ['Astro', 'siAstro', '#BC52EE', 'withastro/astro', 'astro'],
  ['Angular', 'siAngular', '#DD0031', 'angular/angular', '@angular/core'], ['React Router / Remix', 'siReactrouter', '#CA4245', 'remix-run/react-router', 'react-router'],
  ['TanStack Router', 'siTanstack', '#1f1f1f', 'TanStack/router', '@tanstack/react-router'], ['Vite', 'siVite', '#9135FF', 'vitejs/vite', 'vite'],
  ['Storybook', 'siStorybook', '#FF4785', 'storybookjs/storybook', 'storybook'], ['Playwright', null, '#2EAD33', 'microsoft/playwright', '@playwright/test'],
  ['WordPress', 'siWordpress', '#21759B', 'WordPress/WordPress', null], ['Elementor', 'siElementor', '#92003B', 'elementor/elementor', null],
  ['Claude Code', 'siClaude', '#D97757', 'anthropics/claude-code', '@anthropic-ai/claude-code'], ['GitHub Actions', 'siGithubactions', '#2088FF', null, null, 'CI annotations on PRs'],
].map(([name, si, color, repo, npm, note]) => ({ name, color, repo, npm, note, mark: si ? brand(si, color) : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="${color}"/></svg>` })));
export const WORKS_WITH = marquee(WW, { min: 16, seconds: 70 });

// Projects that merged fixes for bugs renderlint found (PRs merged 19–24 November 2026; Hugo's maintainer landed ours as hugoDocs#3860, co-authored).
// Panda CSS is not in Simple Icons: its mark is from the project's own repo (apps/playground/src/components/Logo.tsx).
export const MERGED_POST = '/blog/layout-bugs-fixed-ant-design-mantine-nuxt-ui-panda-css/';
const PANDA_COLOR = '<svg viewBox="0 0 95 96" aria-hidden="true"><path fill="#F6E458" d="M0 11C0 4.92487 4.92487 0 11 0H84C90.0751 0 95 4.92487 95 11V85C95 91.0751 90.0751 96 84 96H11C4.92487 96 0 91.0751 0 85V11Z"/><path fill="#111" d="M60.8796 21.4585C55.6382 19.9529 50.2921 19.7483 44.844 20.2355C41.7952 20.5523 38.8641 21.1575 36.037 22.2195C29.9261 24.5149 25.3378 28.4905 22.6019 34.4762C20.6404 38.7674 19.9316 43.3259 19.8577 48.003C19.7796 52.9459 20.399 57.8204 21.3833 62.6531C22.2754 67.0336 23.4635 71.3285 25.1603 75.474C25.3215 75.8679 25.5223 76.0009 25.9526 76C31.3191 75.9884 36.6857 75.9885 42.0523 75.9885C43.641 75.9885 45.2298 75.9885 46.8185 75.9882C46.9401 75.9882 47.0618 75.9815 47.2017 75.9738C47.2731 75.9699 47.3493 75.9657 47.4326 75.962C47.4003 75.8852 47.3715 75.8148 47.3444 75.7486C47.2913 75.6187 47.245 75.5057 47.1934 75.3952C46.8053 74.565 46.4092 73.7383 46.0131 72.9116C45.154 71.1184 44.2948 69.3252 43.5177 67.4972C41.161 61.9527 39.3562 56.244 38.8055 50.2012C38.5625 47.5349 38.5962 44.8838 39.336 42.2858C40.1816 39.3161 41.9962 37.2196 45.0045 36.3431C47.767 35.5383 50.5678 35.5436 53.3153 36.432C55.7674 37.225 57.366 38.8999 58.0461 41.4078C58.5683 43.3338 58.5682 45.2806 58.173 47.2223C57.8688 48.7173 57.2563 50.0816 56.1539 51.1729C54.1763 53.1305 51.7066 53.5806 49.0565 53.4306C48.585 53.4039 48.115 53.3522 47.6306 53.2989C47.4037 53.274 47.1737 53.2487 46.939 53.2255C46.9457 53.3005 46.9495 53.3696 46.9529 53.4343C46.9598 53.5617 46.9658 53.6721 46.992 53.7775C47.1049 54.2314 47.2125 54.687 47.3202 55.1426C47.5794 56.24 47.8387 57.3376 48.172 58.4122C48.8266 60.5223 49.5878 62.5816 50.4507 64.5922C56.6017 64.1122 62.2673 62.5831 68.2805 58.9734C68.3708 58.9165 68.4528 58.865 68.535 58.8138C71.1179 57.2059 73.2084 55.1199 74.6501 52.4264C76.9847 48.0644 77.4398 43.3997 76.7462 38.5848C76.0304 33.6159 73.8004 29.4451 69.9619 26.1735C67.2995 23.9043 64.2208 22.4183 60.8796 21.4585Z"/></svg>';
const MERGED = await stats([
  ['Ant Design', brand('siAntdesign', '#0170FE'), '#0170FE', 'ant-design/ant-design', 'antd', 'https://github.com/ant-design/ant-design/pull/59920'],
  ['Hugo', brand('siHugo', '#FF4088'), '#FF4088', 'gohugoio/hugo', null, 'https://github.com/gohugoio/hugoDocs/pull/3860'],
  ['Mantine', brand('siMantine', '#339AF0'), '#339AF0', 'mantinedev/mantine', '@mantine/core', 'https://github.com/mantinedev/mantine/pull/9447'],
  ['Ruby', brand('siRuby', '#CC342D'), '#CC342D', 'ruby/ruby', null, 'https://github.com/ruby/www.ruby-lang.org/pull/4083'],
  ['Nuxt UI', brand('siNuxt', '#00DC82'), '#00DC82', 'nuxt/ui', '@nuxt/ui', 'https://github.com/nuxt/ui/pull/7445'],
  ['Panda CSS', PANDA_COLOR, '#E3C600', 'chakra-ui/panda', '@pandacss/dev', 'https://github.com/chakra-ui/panda/pull/4110'],
].map(([name, mark, color, repo, npm, href]) => ({ name, mark, color, repo, npm, href })));
export const MERGED_IN = marquee(MERGED, { min: 10, reverse: true, seconds: 45 });
fs.writeFileSync(STATS_FILE, JSON.stringify(statsCache, null, 1) + '\n');

// ---- shared chrome ----------------------------------------------------------------------------
export const copyCmd = (cmd, label = 'Copy') => `<div class="cmd"><code>${esc(cmd)}</code><button class="copy" type="button" data-copy="${esc(cmd)}" aria-label="Copy the command ${esc(cmd)}">${ICON.copy}<span>${label}</span></button></div>`;

const NAV = [['/examples/', 'Examples'], ['/rules/', 'Rules'], ['/blog/', 'Blog'], ['/get-started/', 'Get started']];
function header(current) {
  const links = NAV.map(([href, label]) => `<li><a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  return `<header class="top">
<a class="brand" href="/" aria-label="renderlint home">${MARK}renderlint<small>v${VERSION}</small></a>
<ul class="nav">${links}</ul>
<div class="top-cta"><a class="gh" href="${REPO}">${ICON.github}GitHub</a><a class="btn" href="/get-started/">Install <span>— it's free</span></a>
<details class="menu"><summary aria-label="Menu">${ICON.menu}</summary><ul>${links}<li><a href="${REPO}">GitHub</a></li></ul></details></div>
</header>`;
}
function footer() {
  return `<footer class="foot"><div class="wrap">
<div class="about"><a class="brand" href="/">${MARK}renderlint</a><p>A linter for the rendered UI. Open source under the MIT license. Node 18.17 or newer.</p></div>
<nav aria-labelledby="f1"><h2 id="f1">Product</h2><ul><li><a href="/get-started/">Get started</a></li><li><a href="/examples/">Before and after</a></li><li><a href="/rules/">All ${Object.keys(RULES).length} rules</a></li><li><a href="/blog/">Blog</a></li></ul></nav>
<nav aria-labelledby="f2"><h2 id="f2">Project</h2><ul><li><a href="${REPO}">GitHub</a></li><li><a href="${REPO}/tree/master/docs">Documentation</a></li><li><a href="${REPO}/blob/master/CHANGELOG.md">Changelog</a></li><li><a href="${NPM}">npm package</a></li></ul></nav>
<nav aria-labelledby="f3"><h2 id="f3">Follow</h2><ul><li><a href="/feed.xml">Atom feed</a></li><li><a href="/rss.xml">RSS feed</a></li><li><a href="/llms.txt">llms.txt</a></li><li><a href="https://gitlab.com/anhnn.a05/renderlint">GitLab mirror</a></li></ul></nav>
<div class="legal"><span>© 2026 renderlint contributors. MIT licensed.</span><span>Project names and logos belong to their owners. They are shown only to say what renderlint works with and which projects have merged fixes for bugs it found.</span></div>
</div></footer>`;
}

const ORG = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'renderlint', url: `${SITE}/`, logo: `${SITE}/icon-512.png`, sameAs: [REPO, NPM, 'https://gitlab.com/anhnn.a05/renderlint'] };
const crumbsLd = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + url })) });
export function crumbs(items) {
  return `<nav aria-label="Breadcrumb"><ol class="crumbs">${items.map(([name, url], i) => i < items.length - 1 ? `<li><a href="${url}">${esc(name)}</a></li>` : `<li aria-current="page">${esc(name)}</li>`).join('')}</ol></nav>`;
}

const pages = []; // for sitemap and llms.txt
function page({ url, title, description, body, current, ld = [], og, type = 'website', crumbs: cr, lastmod, extraHead = '', llms }) {
  const canonical = SITE + url;
  const graph = [ORG, ...ld];
  if (cr) graph.push(crumbsLd(cr));
  const ogImg = `${SITE}/og/${og}.jpg`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#e7e6e3">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/atom+xml" title="renderlint blog" href="/feed.xml">
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-serif-400.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="renderlint">
<meta name="application-name" content="renderlint">
<meta name="apple-mobile-web-app-title" content="renderlint">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImg}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImg}">
${extraHead}<style>${css}</style>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="sheet">
${header(current)}
<main id="main">
${body}
</main>
${footer()}
</div>
<script>${js}</script>
</body>
</html>
`;
  write(url.endsWith('/') ? `${url}index.html` : url, html);
  if (url !== '/404.html') pages.push({ url, title, description, lastmod: lastmod || '2026-11-16', llms });
}

// ---- markdown ---------------------------------------------------------------------------------
async function renderMarkdown(md) {
  // Images (with an optional "*Caption:* …" line right after) become optimised figures.
  const figures = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)(?:\n\*Caption:\*\s*([^\n]+))?/g;
  for (const m of md.matchAll(re)) figures.push(m);
  for (const m of figures) {
    const [all, alt, src, caption] = m;
    const tag = await img(src, alt);
    const cap = caption ? `<figcaption>${new Marked().parseInline(caption)}</figcaption>` : '';
    md = md.replace(all, `\n<figure>${tag}${cap}</figure>\n`);
  }
  const toc = [];
  const used = new Set();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(text);
        while (used.has(id)) id += '-2';
        used.add(id);
        if (depth === 2) toc.push({ id, text: inner.replace(/<[^>]+>/g, '') });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      code({ text, lang }) {
        // Quoted tool output can contain emoji from the page it checked (e.g. "🥦 Broccoli"): that is content, not an icon.
        const quoted = /\p{Extended_Pictographic}/u.test(text) ? ' data-renderlint-ignore="emoji" data-renderlint-reason="quoted renderlint output from another site"' : '';
        if (lang === 'text' || lang === 'console') return `<pre class="term"${quoted}><code>${terminal(text)}</code></pre>\n`;
        return `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(text)}</code></pre>\n`;
      },
    },
  });
  let html = marked.parse(md);
  // Tables with 3+ columns (or a long code token) get a minimum width and scroll inside .table-wrap; narrower ones fit the column.
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, (m, inner) => {
    const cols = ((inner.match(/<tr>([\s\S]*?)<\/tr>/) || [, ''])[1].match(/<t[hd][\s>]/g) || []).length;
    const longCode = /<code>[^<]*?[^\s<]{16,}/.test(inner);
    return `<div class="table-wrap${cols >= 3 || longCode ? ' wide' : ''}"><table>${inner}</table></div>`;
  });
  // external links open in place but are marked for screen readers? keep plain; add rel for safety
  html = html.replace(/<a href="(https?:\/\/(?!renderlint\.yitec\.net)[^"]+)"/g, '<a href="$1" rel="noopener"');
  return { html, toc };
}

// FAQ sections in Markdown ("## Frequently asked questions" + "### Question" + answer) → FAQPage data
function extractFaq(md) {
  const sec = md.split(/\n## Frequently asked questions\n/)[1];
  if (!sec) return [];
  const body = sec.split(/\n## /)[0];
  return body.split(/\n### /).slice(1).map((chunk) => {
    const [q, ...rest] = chunk.split('\n');
    const a = rest.join('\n').trim().replace(/```[\s\S]*?```/g, '').replace(/[`*_]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
    return { q: q.trim(), a };
  }).filter((x) => x.a);
}
const faqLd = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });

// ---- blog -------------------------------------------------------------------------------------
const blogDir = path.join(site, 'content', 'blog');
const posts = [];
for (const f of fs.readdirSync(blogDir).filter((f) => f.endsWith('.md'))) {
  const src = fs.readFileSync(path.join(blogDir, f), 'utf8');
  const { data, body } = frontMatter(src);
  for (const k of ['title', 'description', 'slug', 'date']) if (!data[k]) throw new Error(`${f}: missing ${k}`);
  const words = body.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;
  posts.push({ ...data, file: f, body, words, minutes: Math.max(1, Math.round(words / 230)), rules: (data.rule || '').split(',').map((s) => s.trim()).filter(Boolean), tags: (data.tags || '').split(',').map((s) => s.trim()).filter(Boolean) });
}
// a stable reading order: the order of the brief
const ORDER = ['layout-bugs-fixed-ant-design-mantine-nuxt-ui-panda-css', 'text-overflow-clipped-text-responsive-layouts', 'color-contrast-gradients-images', 'content-you-cant-scroll-to', 'dropdown-cut-off-overflow-hidden-z-index', 'loading-states-layout-shift', 'test-every-route-and-role-behind-login', 'catch-ui-bugs-ai-coding-agents', 'visual-regression-testing-vs-rendered-ui-linting', 'replace-alert-confirm-prompt', 'form-control-layout-bugs'];
posts.sort((a, b) => (ORDER.indexOf(a.slug) + 1 || 99) - (ORDER.indexOf(b.slug) + 1 || 99));
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const postCard = (p, h = 'h2') => `<a class="post" href="/blog/${p.slug}/"><time datetime="${p.date}">${fmtDate(p.date)} · ${p.minutes} min read</time><${h}>${esc(p.title)}</${h}><p>${esc(p.description)}</p><span class="rules">${p.rules.slice(0, 4).map((r) => `<code>${esc(r)}</code>`).join('')}</span></a>`;

const callout = `<aside class="callout" aria-labelledby="cta-h"><h2 id="cta-h">Check your own pages</h2><p>renderlint renders every page at phone, tablet and desktop widths, finds defects like these and tells you the element, the source file and the fix. Free and open source.</p>${copyCmd(INSTALL)}<div class="row"><a href="/get-started/">Read the setup guide</a><a href="${REPO}">renderlint on GitHub</a></div></aside>`;

for (const p of posts) {
  const { html, toc } = await renderMarkdown(p.body);
  p.html = html;
  const faq = extractFaq(p.body);
  const url = `/blog/${p.slug}/`;
  const related = posts.filter((o) => o !== p).map((o) => ({ o, score: o.tags.filter((t) => p.tags.includes(t)).length + o.rules.filter((r) => p.rules.includes(r)).length })).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.o);
  const ruleLinks = p.rules.filter((r) => RULES[r]).map((r) => `<a href="/rules/#${r}"><code>${r}</code></a>`).join(', ');
  const body = `<div class="page-head"><div class="wrap">${crumbs([['Home', '/'], ['Blog', '/blog/'], [p.title, url]])}
<h1>${esc(p.title)}</h1>
<div class="meta"><span>By <a href="${AUTHOR.url}" rel="author">${AUTHOR.name}</a></span><span>Published <time datetime="${p.date}">${fmtDate(p.date)}</time></span><span>${p.minutes} min read</span>${ruleLinks ? `<span>Rules: ${ruleLinks}</span>` : ''}</div>
</div></div>
<div class="wrap article">
<article class="prose">${html}${callout}</article>
<nav class="toc" aria-labelledby="toc-h"><h2 id="toc-h">On this page</h2><ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></nav>
</div>
<section class="wrap section" aria-labelledby="rel-h"><h2 id="rel-h" style="margin-bottom:28px">Related articles</h2><div class="related">${related.map((o) => postCard(o, 'h3')).join('')}</div></section>
<div style="height:clamp(48px,7vw,96px)"></div>`;
  const ld = [{
    '@type': 'BlogPosting', '@id': `${SITE}${url}#article`, headline: p.title, description: p.description, datePublished: p.date, dateModified: p.updated || p.date,
    author: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url }, publisher: { '@id': `${SITE}/#org` }, image: `${SITE}/og/blog-${p.slug}.jpg`,
    mainEntityOfPage: `${SITE}${url}`, keywords: p.tags.join(', '), wordCount: p.words, inLanguage: 'en',
    about: { '@id': `${SITE}/#software` },
  }];
  if (faq.length) ld.push(faqLd(faq));
  page({ url, title: `${p.title} | renderlint`, description: p.description, body, current: '/blog/', ld, og: `blog-${p.slug}`, type: 'article', crumbs: [['Home', '/'], ['Blog', '/blog/'], [p.title, url]], lastmod: p.updated || p.date,
    extraHead: `<meta property="article:published_time" content="${p.date}">\n<meta property="article:author" content="${AUTHOR.url}">\n`, llms: p.description });
}

page({
  url: '/blog/', title: 'Blog: UI quality checks for the rendered page | renderlint', current: '/blog/', og: 'blog',
  description: 'Practical articles on UI defects that code review misses: text overflow, contrast on gradients, unreachable content, cut-off menus, loading states and more.',
  crumbs: [['Home', '/'], ['Blog', '/blog/']], llms: 'Index of articles.',
  ld: [{ '@type': 'Blog', '@id': `${SITE}/blog/#blog`, name: 'renderlint blog', url: `${SITE}/blog/`, publisher: { '@id': `${SITE}/#org` }, blogPost: posts.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}/`, datePublished: p.date, author: { '@type': 'Person', name: AUTHOR.name } })) }],
  body: `<div class="page-head"><div class="wrap">${crumbs([['Home', '/'], ['Blog', '/blog/']])}<h1>Notes on UI that looks right in code and wrong on screen</h1><p class="lede">Each article explains one class of visual defect: why the browser draws it that way, how to fix it in CSS or markup, and how to catch it automatically before it ships.</p></div></div>
<section class="wrap section" style="padding-top:clamp(40px,5vw,64px)" aria-label="Articles"><div class="posts">${posts.map((p) => postCard(p)).join('')}</div></section><div style="height:clamp(48px,7vw,96px)"></div>`,
});

// ---- rules ------------------------------------------------------------------------------------
const CAT_NAMES = { layout: 'Layout', responsive: 'Responsive', overlap: 'Overlap', color: 'Color', polish: 'Polish', content: 'Content', a11y: 'Accessibility', readability: 'Readability', forms: 'Forms', ux: 'UX', runtime: 'Runtime' };
const mdInline = (s) => new Marked().parseInline(esc(s).replace(/&lt;(\/?)(svg|dialog|img|meta)/g, '&amp;lt;$1$2'));
{
  const cats = {};
  for (const [id, r] of Object.entries(RULES)) (cats[r.category] ||= []).push([id, r]);
  const articlesFor = (id) => posts.filter((p) => p.rules.includes(id));
  const nErr = Object.values(RULES).filter((r) => r.severity === 'error').length;
  const body = `<div class="page-head"><div class="wrap">${crumbs([['Home', '/'], ['Rules', '/rules/']])}<h1>All ${Object.keys(RULES).length} renderlint rules</h1>
<p class="lede">Each rule checks the rendered page, not the source. ${nErr} rules are errors by default and fail the run (exit code 1); the rest are warnings. Every rule can be set to <code>"error"</code>, <code>"warn"</code> or <code>"off"</code> in <code>renderlint.config.json</code>, and <code>npx renderlint explain &lt;rule&gt;</code> prints the same text in the terminal.</p>
<ul class="chips" style="margin-top:26px" aria-label="Categories">${Object.keys(cats).map((c) => `<li><a href="#cat-${c}">${CAT_NAMES[c] || c} (${cats[c].length})</a></li>`).join('')}</ul></div></div>
<div class="wrap">${Object.entries(cats).map(([c, list]) => `<section class="cat" aria-labelledby="cat-${c}"><h2 id="cat-${c}">${CAT_NAMES[c] || c}</h2>${list.map(([id, r]) => {
    const arts = articlesFor(id);
    const quotes = id === 'placeholder-text' ? ' data-renderlint-ignore="placeholder-text" data-renderlint-reason="The rule description quotes the placeholders it looks for."' : '';
    return `<div class="rule" id="${id}"${quotes}><h3><a href="#${id}">${id}</a> <span class="sev ${r.severity}">${r.severity === 'warn' ? 'warning' : 'error'}</span></h3><div><p>${mdInline(r.summary)}</p><p class="fix"><b>How to fix:</b> ${mdInline(r.fix)}</p>${arts.length ? `<p class="reads">Read more: ${arts.map((a) => `<a href="/blog/${a.slug}/">${esc(a.title)}</a>`).join(' · ')}</p>` : ''}</div></div>`;
  }).join('')}</section>`).join('')}
<section class="cat" aria-labelledby="ignore-h"><h2 id="ignore-h">Intentional exceptions</h2><div class="prose-wide"><p>When a finding is intentional (a watermark, a teaser, a chat message that contains emoji), mark the element. The mark applies to the element and its descendants, and is reviewed like an <code>eslint-disable</code>.</p>
<pre><code class="language-html">${esc('<div data-renderlint-ignore="emoji" data-renderlint-reason="user-generated chat">…</div>\n<p data-renderlint-ignore>…</p>   <!-- all rules, this subtree -->')}</code></pre>
<pre><code class="language-css">.watermark { --renderlint-ignore: contrast; }   /* from CSS, inherited */</code></pre>
<p>In source files (static scan), write <code>// renderlint-ignore emoji</code> on the line or the line above, or <code>renderlint-ignore-file</code> anywhere in the file. Config can also ignore by selector or page: <code>"ignore": [{ "rule": "contrast", "selector": ".legal" }]</code>.</p></div></section>
</div><div style="height:clamp(48px,7vw,96px)"></div>`;
  page({
    url: '/rules/', title: `All ${Object.keys(RULES).length} rules: what renderlint checks on the rendered page`, current: '/rules/', og: 'rules',
    description: `Reference for every renderlint rule: text overflow, contrast from real pixels, overlap, unreachable content, menus, forms, loading states and more, with fixes.`,
    crumbs: [['Home', '/'], ['Rules', '/rules/']], llms: 'Every rule with its default severity, what it catches and how to fix it.',
    ld: [{ '@type': 'TechArticle', headline: `renderlint rules reference`, url: `${SITE}/rules/`, about: { '@id': `${SITE}/#software` }, dateModified: '2026-11-16' }],
    body,
  });
}

// ---- home, get started, examples, 404 ---------------------------------------------------------
const ctx = { posts, postCard, copyCmd, ICON, WORKS_WITH, MERGED_IN, MERGED_POST, img, image, terminal, esc, crumbs, RULES, VERSION, REPO, NPM, INSTALL, PKG, SITE };
const software = {
  '@type': 'SoftwareApplication', '@id': `${SITE}/#software`, name: 'renderlint', alternateName: PKG,
  description: 'An open-source command-line tool that renders a web app in headless Chromium and reports visual UI defects: overflowing and clipped text, low contrast measured from pixels, overlapping elements, unreachable content, hidden menus, broken form controls and missing loading states.',
  applicationCategory: 'DeveloperApplication', applicationSubCategory: 'Linter', operatingSystem: 'Linux, macOS, Windows (Node.js 18.17 or newer)',
  softwareVersion: VERSION, license: 'https://opensource.org/licenses/MIT', url: `${SITE}/`, downloadUrl: NPM, installUrl: `${SITE}/get-started/`,
  codeRepository: REPO, isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@id': `${SITE}/#org` },
  featureList: ['Renders pages at 375, 768 and 1280px and sweeps 13 widths from 320 to 1920px', 'Contrast measured from the real pixels behind each glyph', 'Opens menus, dropdowns and comboboxes to check they can be seen', 'Holds API requests to find missing loading states', 'Checks every route and role behind a login', 'Claude Code Stop hook, Vite plugin, Playwright and Storybook integrations', `${Object.keys(RULES).length} rules`],
};
page({
  url: '/', title: 'renderlint: a linter for the rendered UI', current: '/', og: 'home',
  description: 'renderlint opens your app in a real browser, finds visual UI defects like overflow, low contrast and hidden menus, and fails the build until they are fixed.',
  ld: [software, { '@type': 'WebSite', '@id': `${SITE}/#website`, name: 'renderlint', alternateName: ['renderlint CLI', 'renderlint.yitec.net'], url: `${SITE}/`, inLanguage: 'en', publisher: { '@id': `${SITE}/#org` } }, faqLd(FAQ)],
  body: await home(ctx), llms: 'What renderlint is, what it catches, how it works, results and FAQ.',
  extraHead: '<link rel="preload" href="/media/hero-poster.webp" as="image" type="image/webp" fetchpriority="high">\n',
});
page({
  url: '/get-started/', title: 'Get started with renderlint: install, run and gate your builds', current: '/get-started/', og: 'get-started',
  description: 'Install renderlint in one command, check any app or static build, and make CI, Vite builds and Claude Code fail on visual UI defects. Setup for every framework.',
  crumbs: [['Home', '/'], ['Get started', '/get-started/']], llms: 'Installation, usage, configuration, CI and agent setup.',
  ld: [{ '@type': 'HowTo', name: 'Set up renderlint in a project', totalTime: 'PT5M', tool: [{ '@type': 'HowToTool', name: 'Node.js 18.17 or newer' }], step: [
    { '@type': 'HowToStep', name: 'Run init', text: `Run ${INSTALL} in the project folder. It installs renderlint, writes renderlint.config.json, adds a build gate, agent instructions and a Claude Code hook.` },
    { '@type': 'HowToStep', name: 'Check the app', text: 'Run npx renderlint. It finds a running dev server, your dev script, a build folder or index.html, and exits 1 if any error is found.' },
    { '@type': 'HowToStep', name: 'Fix and re-run', text: 'Fix each finding using the element, source file, screenshot and fix hint in the report, and re-run until it shows 0 errors.' },
  ] }],
  body: await getStarted(ctx),
});
page({
  url: '/examples/', title: 'Before and after: real UI defects renderlint caught', current: '/examples/', og: 'examples',
  description: 'Real renderlint output on real pages: overflow, contrast, unreachable content, hidden menus, forms, loading states and alert(), each with its fix.',
  crumbs: [['Home', '/'], ['Examples', '/examples/']], llms: 'Before/after pairs with the exact renderlint output.',
  ld: [{ '@type': 'CollectionPage', name: 'renderlint before and after examples', url: `${SITE}/examples/` }],
  body: await examples(ctx),
});
page({
  url: '/404.html', title: 'Page not found | renderlint', og: 'home', description: 'This page does not exist.',
  body: `<div class="wrap notfound"><h1 style="font:400 clamp(3rem,2rem + 5vw,6rem)/1 var(--serif);letter-spacing:-.03em">Nothing rendered here</h1><p style="font-size:1.2rem;margin-top:20px;max-width:32em">The page you asked for doesn't exist. renderlint would report this as <code>page-error</code>.</p><p><a class="btn" href="/">Go to the home page</a></p></div>`,
});

// ---- feeds, sitemap, robots, llms -------------------------------------------------------------
const abs = (html) => html.replace(/(src|href)="\//g, `$1="${SITE}/`).replace(/srcset="([^"]+)"/g, (m, s) => `srcset="${s.replace(/(^|, )\//g, `$1${SITE}/`)}"`);
const updated = posts.map((p) => p.updated || p.date).sort().pop();
write('feed.xml', `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>renderlint blog</title>
<subtitle>UI quality checks for the rendered page.</subtitle>
<link href="${SITE}/feed.xml" rel="self"/>
<link href="${SITE}/blog/"/>
<id>${SITE}/blog/</id>
<updated>${updated}T00:00:00Z</updated>
<author><name>${AUTHOR.name}</name><uri>${AUTHOR.url}</uri></author>
${posts.map((p) => `<entry>
<title>${esc(p.title)}</title>
<link href="${SITE}/blog/${p.slug}/"/>
<id>${SITE}/blog/${p.slug}/</id>
<published>${p.date}T00:00:00Z</published>
<updated>${p.updated || p.date}T00:00:00Z</updated>
<summary>${esc(p.description)}</summary>
<content type="html">${esc(abs(p.html))}</content>
</entry>`).join('\n')}
</feed>
`);
const rfc822 = (d) => new Date(d + 'T00:00:00Z').toUTCString();
write('rss.xml', `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>renderlint blog</title>
<link>${SITE}/blog/</link>
<description>UI quality checks for the rendered page.</description>
<language>en</language>
<atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
<lastBuildDate>${rfc822(updated)}</lastBuildDate>
${posts.map((p) => `<item>
<title>${esc(p.title)}</title>
<link>${SITE}/blog/${p.slug}/</link>
<guid isPermaLink="true">${SITE}/blog/${p.slug}/</guid>
<pubDate>${rfc822(p.date)}</pubDate>
<description>${esc(p.description)}</description>
</item>`).join('\n')}
</channel>
</rss>
`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `<url><loc>${SITE}${p.url}</loc><lastmod>${p.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

const rulesList = Object.entries(RULES).map(([id, r]) => `- ${id} (${r.severity === 'warn' ? 'warning' : 'error'}): ${r.summary}`).join('\n');
const llmsIntro = `# renderlint

> renderlint (npm: ${PKG}) is an open-source (MIT) command-line linter for the rendered UI. It opens a web app in headless Chromium at phone, tablet and desktop widths (375, 768 and 1280px by default, plus a sweep of 13 widths from 320 to 1920px), finds visual defects that code checks can't see, and exits non-zero until they are fixed. Each finding names the element, the source file, an annotated screenshot and a concrete fix, in plain text a coding agent can act on.

Key facts:
- ${Object.keys(RULES).length} rules: text overflow and clipping, contrast measured from real pixels (works on gradients and images), overlap, unreachable content, menus cut off or drawn underneath, form-control layout, leaked placeholders (undefined, NaN), emoji icons, broken images, missing loading states, layout shift, alert()/confirm(), pages behind a login, and runtime errors.
- Works with any framework that renders in a browser: Next.js, React, Vue, Nuxt, Svelte/SvelteKit, Astro, Angular, React Router/Remix, TanStack Router, Vite, plain HTML, WordPress and Elementor. Integrations: build scripts, a Vite plugin, a Claude Code Stop hook, AGENTS.md and skills for other agents, Playwright Test, Storybook, GitHub Actions annotations.
- No baseline images: it judges each page on its own, unlike visual regression testing.
- In an experiment with 22 headless Claude Code sessions, the 11 apps built without renderlint had 229 errors between them; the 11 built with it finished at 0.
- Bugs it found on the websites and docs of Ant Design, Hugo, Mantine, Ruby (ruby-lang.org), Nuxt UI and Panda CSS were fixed and merged upstream in November 2026: ${SITE}${MERGED_POST}
- Install: \`${INSTALL}\` then \`npx renderlint\`. Requires Node.js 18.17+. Source: ${REPO}
`;
write('llms.txt', `${llmsIntro}
## Pages
${pages.filter((p) => !p.url.startsWith('/blog/') || p.url === '/blog/').map((p) => `- [${p.title}](${SITE}${p.url}): ${p.description}`).join('\n')}

## Articles
${posts.map((p) => `- [${p.title}](${SITE}/blog/${p.slug}/): ${p.description}`).join('\n')}

## Documentation (GitHub)
- [README](${REPO}#readme): overview, usage, configuration, limitations
- [Rules](${REPO}/blob/master/docs/rules.md)
- [Configuration](${REPO}/blob/master/docs/configuration.md)
- [Authentication](${REPO}/blob/master/docs/authentication.md) and [roles and coverage](${REPO}/blob/master/docs/roles-and-coverage.md)
- [Results of the agent experiments](${REPO}/blob/master/docs/results.md)
- [Changelog](${REPO}/blob/master/CHANGELOG.md)

## Optional
- [Full text of this site](${SITE}/llms-full.txt)
`);
const plainMd = (md) => md.replace(/!\[([^\]]*)\]\([^)]+\)\n?(\*Caption:\*[^\n]*\n?)?/g, '');
write('llms-full.txt', `${llmsIntro}
## Rules
${rulesList}

## README
${fs.readFileSync(path.join(repo, 'README.md'), 'utf8').replace(/<[^>]+>/g, '').replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\n{3,}/g, '\n\n')}

${posts.map((p) => `---\n\n# ${p.title}\n\nURL: ${SITE}/blog/${p.slug}/\nPublished: ${p.date}. Author: ${AUTHOR.name}.\n\n${plainMd(p.body).trim()}\n`).join('\n')}`);

// ---- OG images (cached by content hash) --------------------------------------------------------
const ogList = [
  { name: 'home', kicker: 'Open source · MIT', title: 'A linter for the rendered UI' },
  { name: 'get-started', kicker: 'Get started', title: 'Install renderlint in one command' },
  { name: 'rules', kicker: 'Reference', title: `All ${Object.keys(RULES).length} renderlint rules` },
  { name: 'examples', kicker: 'Before and after', title: 'Real defects, real output, real fixes' },
  { name: 'blog', kicker: 'Blog', title: 'Notes on UI that looks right in code and wrong on screen' },
  ...posts.map((p) => ({ name: `blog-${p.slug}`, kicker: `Blog · ${p.minutes} min read`, title: p.title })),
];
await ogImages(ogList);
fs.cpSync(path.join(site, 'static', 'og'), path.join(dist, 'og'), { recursive: true, filter: (f) => !f.endsWith('.png') });
fs.rmSync(path.join(dist, 'og', '.hashes.json'), { force: true });

// icons for PWA / Organization logo, from the mark
const sharp = (await import('sharp')).default;
const markSvg = Buffer.from(MARK.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" '));
write('favicon.svg', MARK.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(' aria-hidden="true"', ''));
await sharp(markSvg).resize(512).png().toFile(path.join(dist, 'icon-512.png'));
await sharp(markSvg).resize(180).flatten({ background: '#ffffff' }).png().toFile(path.join(dist, 'apple-touch-icon.png'));
await sharp(markSvg).resize(32).png().toFile(path.join(dist, 'favicon.ico')); // PNG payload: browsers accept it

console.log(`built ${pages.length + 1} pages, ${posts.length} articles in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
