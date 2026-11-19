import { PAIRS } from './pairs.mjs';
import { pairCard } from './home.mjs';

// Images from docs/images with the README's own captions.
const GALLERY = [
  ['docs/hero-overflow.png', 'Six overflow bugs renderlint caught: a long email running off its card, a total cut off only at 1024px, a heading running off a phone screen, chart labels cut off by the SVG edge, a heading clipped by its card, a feature list spilling out of a pricing card', 'Six times text didn’t fit its box, from example pages, apps Claude built in headless sessions, and an Elementor page.'],
  ['docs/demo-unreachable.png', 'Left: a run dashboard whose Findings tab stops at the screen edge with no scrollbar. Right: the same tab without the clipping, most of it shaded as never reachable, next to renderlint’s unreachable-content finding', 'A tab inside a fixed-height app shell that never became a scroller (<code>unreachable-content</code>).'],
  ['docs/demo-charts.png', 'Bar-chart labels overlapping and donut labels cut off by the SVG edge', 'Colliding bar-chart labels (<code>text-overlap</code>) and donut labels cut off by the SVG edge (<code>text-clipped</code>).'],
  ['docs/compare-donut.png', 'Donut labels clipped at 375px without renderlint, wrapped with it', 'A real Claude Haiku session: donut labels clipped on phones, then fixed.'],
  ['docs/demo-kpis.png', 'KPI tiles showing $undefined, NaN% and Invalid Date', 'Leaked <code>$undefined</code>, <code>NaN%</code> and <code>Invalid Date</code> (<code>placeholder-text</code>).'],
  ['docs/demo-team.png', 'Broken avatar, squashed avatar and an unsized icon grown to 204px', 'Broken and squashed images, and an unsized 24×24 icon at 204px.'],
  ['docs/demo-sweep.png', 'KPI cards: fine at 1280px, the spend value cut off at 1024px and boxed by renderlint', 'The width sweep: fine at 1280px, cut off at 1024px.'],
  ['docs/demo-forms-annotated.png', 'An alert-settings form: native select arrows on the border, a checkbox stretched above its label, and a search icon over the placeholder, each boxed by renderlint', 'Form controls that render but are built wrong.'],
  ['docs/ux-loading-state.png', 'renderlint’s screenshot of a dashboard: while the orders request is held, the Recent orders card is empty (boxed in red); once the data arrives, the table fills it', '<code>loading-state</code>: the orders card is blank while its request is held.'],
  ['docs/wordpress-elementor.png', 'renderlint’s annotated screenshot of an Elementor page with findings boxed', 'An Elementor page: findings name the widget and link to the editor.'],
  ['docs/dev-overlay.png', 'renderlint’s dev overlay on a React dashboard, listing findings with source file and line', 'The Vite plugin’s live overlay: each finding links to its component file and line.'],
];

export async function examples(c) {
  const { img, crumbs, REPO } = c;
  const cards = [];
  for (const p of PAIRS) cards.push(await pairCard(p, c, { h: 'h2' }));
  const gallery = [];
  for (const [src, alt, cap] of GALLERY) gallery.push(`<figure class="shot" style="margin:0"><div class="frame">${await img(src, alt, { sizes: '(max-width: 820px) 100vw, 600px' })}</div><figcaption style="display:block;font-weight:400">${cap}</figcaption></figure>`);
  return `<div class="page-head"><div class="wrap">${crumbs([['Home', '/'], ['Examples', '/examples/']])}
<h1>Before and after</h1>
<p class="lede">Seven small pages, each with one kind of defect, and the same pages fixed. Every screenshot and report here is renderlint’s real output from a run on that page; the fixed pages report 0 errors. The pages are in the site’s source, so you can run them yourself.</p></div></div>
<section class="wrap section" style="padding-top:clamp(40px,5vw,64px)" aria-label="Before and after pairs"><div class="pairs">${cards.join('\n')}</div>
<p class="caption" style="margin-top:20px">Reproduce: <code>node bin/renderlint.js site/examples-src/overflow-before.html --no-crawl</code> from a clone of the <a href="${REPO}">repository</a>.</p></section>
<section class="wrap section" aria-labelledby="gal-h"><div class="section-head"><div><span class="kicker">Gallery</span><h2 id="gal-h">More findings from real apps</h2></div><p>From the README and the gallery: example pages, apps built by Claude Code in headless sessions, and a WordPress site. More in <a href="${REPO}/blob/master/docs/gallery.md">docs/gallery.md</a>.</p></div>
<div class="grid-2">${gallery.join('\n')}</div></section>
<div style="height:clamp(48px,7vw,96px)"></div>`;
}
