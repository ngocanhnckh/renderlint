// Storybook: every story is a page of its own, rendered in Storybook's isolated iframe with
// the mocked data and the state the story sets up (props, loaders, MSW handlers, play functions).
//
//   renderlint storybook                     storybook-static/ if built, else a running Storybook on :6006
//   renderlint storybook http://localhost:6006
//   renderlint storybook storybook-static --globals theme:dark
//
// Stories come from Storybook's index.json (v7+; stories.json for 6.4/6.5): docs entries are
// skipped, and so are stories tagged "skip-renderlint". Each one is opened as
// iframe.html?id=<id>&viewMode=story[&globals=…] and checked like any page.
// Component stories (layout "padded" or "centered") are a component on an empty page, not a
// page: whether it is wider than a phone screen depends on where it is used, so the
// page-level rules (viewport-overflow, accidental-scrollbar) only apply to "fullscreen" stories.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveStatic, probe } from './server.js';
import { globMatch } from './runner.js';

const PAGE_RULES = 'viewport-overflow accidental-scrollbar missing-viewport-meta';

export async function storyIndex(base) {
  for (const file of ['index.json', 'stories.json']) {
    let res;
    try { res = await fetch(base + '/' + file, { signal: AbortSignal.timeout(10000) }); } catch { continue; }
    if (!res.ok) continue;
    let data;
    try { data = await res.json(); } catch { continue; }
    const entries = Object.values(data.entries || data.stories || {});
    if (!entries.length) continue;
    return entries
      .filter((e) => (e.type || 'story') === 'story' && !(e.tags || []).includes('skip-renderlint') && !(e.parameters && e.parameters.docsOnly))
      .map((e) => ({ id: e.id, title: e.title || e.kind, name: e.name || e.story, tags: e.tags || [] }));
  }
  throw new Error(`renderlint: no Storybook index at ${base}/index.json. Is this a Storybook (7 or later) build or dev server?`);
}

// "theme:dark;locale:de" → the globals query parameter Storybook reads.
export function storyUrl(base, id, globals) {
  return `${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story${globals ? '&globals=' + encodeURIComponent(globals).replace(/%3A/g, ':').replace(/%3B/g, ';') : ''}`;
}

// Where the Storybook is: a URL, a built folder, storybook-static/, or a dev server on :6006.
export async function resolveStorybook(target, cwd, log = () => {}) {
  if (target && /^https?:\/\//.test(target)) return { base: target.replace(/\/(index|iframe)\.html.*$/, '').replace(/\/$/, ''), close: null };
  const dir = target ? resolve(cwd, target) : join(cwd, 'storybook-static');
  if (existsSync(join(dir, 'iframe.html'))) {
    const srv = await serveStatic(dir);
    log(`Serving the Storybook build ${dir} at ${srv.url}`);
    return { base: srv.url, close: srv.close };
  }
  if (target) throw new Error(`renderlint: ${target} is not a Storybook build (no iframe.html in it)`);
  for (const port of [6006, 6007]) {
    const r = await probe(`http://localhost:${port}/index.json`, { timeout: 1500 });
    if (r && r.status === 200) { log(`Using the Storybook running at http://localhost:${port}`); return { base: `http://localhost:${port}`, close: null }; }
  }
  throw new Error('renderlint: no Storybook found. Build it (`npx storybook build`, writes storybook-static/), start it (`npx storybook dev`), or pass its URL.');
}

// Config for checking stories: one page per story × globals variant, named after the story.
export function storybookConfig(config, stories, base, { globals = [''], include } = {}) {
  const names = new Map();
  const urls = [];
  const pick = include && include.length ? stories.filter((s) => include.some((p) => globMatch(p, s.id) || globMatch(p, `${s.title} / ${s.name}`))) : stories;
  for (const g of globals) {
    for (const s of pick) {
      const url = storyUrl(base, s.id, g);
      urls.push(url);
      names.set(url, `story: ${s.title} / ${s.name}${g ? ` [${g}]` : ''}`);
    }
  }
  const user = config.beforeCheck;
  return {
    urls,
    config: {
      ...config,
      crawl: false,
      // Storybook's own index: stressing it would rename the stories (the data stress is for the stories' data)
      stressDataExclude: [...(config.stressDataExclude || []), '/index.json', '/stories.json', '/project.json'],
      maxPages: Math.max(config.maxPages, urls.length),
      // Rendered when Storybook shows the story (or its error screen).
      waitFor: config.waitFor || 'body.sb-show-main, body.sb-show-errordisplay, body.sb-show-nopreview',
      pageLabel: (url) => names.get(url),
      beforeCheck: async (page, info) => {
        const st = await page.evaluate((pageRules) => {
          const b = document.body;
          if (b.classList.contains('sb-show-errordisplay')) {
            const msg = (document.querySelector('#error-message') || {}).textContent || 'unknown error';
            return { error: msg.trim().split('\n')[0].slice(0, 300) };
          }
          if (b.classList.contains('sb-show-nopreview')) return { error: 'Storybook shows "No Preview" for this story' };
          const root = document.getElementById('storybook-root') || document.getElementById('root');
          const fullscreen = b.classList.contains('sb-main-fullscreen');
          if (root && !fullscreen) {
            const prev = root.getAttribute('data-renderlint-ignore');
            if (prev !== '') root.setAttribute('data-renderlint-ignore', [prev, pageRules].filter(Boolean).join(' '));
          }
          return { fullscreen };
        }, PAGE_RULES);
        if (st.error) throw new Error('the story failed to render: ' + st.error);
        // The play function (a state reached by clicking, typing…) runs after the story shows: wait for it.
        const phase = await page.waitForFunction(() => {
          const r = window.__STORYBOOK_PREVIEW__ && window.__STORYBOOK_PREVIEW__.currentRender;
          return !r || !r.phase || /^(finished|completed|played|errored|aborted)$/.test(r.phase) ? (r && r.phase) || 'none' : false;
        }, null, { timeout: 15000, polling: 50 }).then((h) => h.jsonValue()).catch(() => 'timeout');
        if (phase === 'errored') {
          const msg = await page.evaluate(() => ((document.querySelector('#error-message') || {}).textContent || '').trim().split('\n')[0].slice(0, 300)).catch(() => '');
          throw new Error('the story\'s play function failed' + (msg ? ': ' + msg : ''));
        }
        if (phase !== 'none') await page.evaluate(() => window.__rlWaitQuiet && window.__rlWaitQuiet(500, 3));
        if (user) await user(page, info);
      },
    },
  };
}
