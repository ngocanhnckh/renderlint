// Route discovery from source trees (no app running), URL ↔ pattern matching, the import graph and
// change-based selection. The same layouts were checked against real generated apps (create-next-app,
// nuxi, sv, create-astro, create-react-router, create-tsrouter-app, ng new, create-vue): every route found there was
// loaded in Chromium and rendered the page its pattern names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverRoutes, fillPattern, staticParamsFrom } from '../src/routes/discover.js';
import { matchRoute, inferPatterns } from '../src/routes/match.js';
import { buildGraph, routeClosures, affectedRoutes, shellEntries } from '../src/routes/graph.js';
import { choose, coverageGate, coverageLine } from '../src/routes/plan.js';

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rl-routes-'));
  for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); }
  return dir;
}
const pkg = (deps) => JSON.stringify({ dependencies: deps });
const patterns = (d) => d.routes.map((r) => r.pattern).sort();
const P = 'export default function P() { return null; }\n';

test('Next.js app router: groups, slots, intercepting and private folders, catch-alls, generateStaticParams; pages router', () => {
  const dir = tree({
    'package.json': pkg({ next: '16' }),
    'src/app/layout.tsx': P, 'src/app/page.tsx': P,
    'src/app/(marketing)/about/page.tsx': P, 'src/app/(marketing)/layout.tsx': P,
    'src/app/(shop)/products/[id]/page.tsx': "export function generateStaticParams() {\n  return [{ id: 'a1' }, { id: 'b2' }];\n}\n" + P,
    'src/app/docs/[...slug]/page.tsx': P, 'src/app/shop/[[...filters]]/page.tsx': P,
    'src/app/dashboard/layout.tsx': P, 'src/app/dashboard/page.tsx': P, 'src/app/dashboard/default.tsx': P,
    'src/app/dashboard/@team/page.tsx': P, 'src/app/dashboard/@team/members/page.tsx': P, 'src/app/dashboard/@team/default.tsx': P,
    'src/app/photos/[id]/page.tsx': P, 'src/app/@modal/(.)photos/[id]/page.tsx': P, 'src/app/@modal/default.tsx': P,
    'src/app/_private/page.tsx': P, 'src/app/%5Fintern/page.tsx': P, 'src/app/api/hello/route.ts': 'export function GET() {}',
    'src/pages/legacy/[slug].tsx': "export function getStaticPaths() {\n  return { paths: [{ params: { slug: 'x1' } }], fallback: false };\n}\n" + P,
    'src/pages/_app.tsx': P, 'src/pages/api/x.ts': P,
  });
  const d = discoverRoutes(dir);
  assert.equal(d.framework, 'next');
  assert.deepEqual(patterns(d), ['/', '/_intern', '/about', '/dashboard', '/dashboard/members', '/docs/:slug+', '/legacy/:slug', '/photos/:id', '/products/:id', '/shop/:filters*'].sort());
  const product = d.routes.find((r) => r.pattern === '/products/:id');
  assert.deepEqual(product.values, [{ id: 'a1' }, { id: 'b2' }]);
  assert.deepEqual(product.files, ['src/app/(shop)/products/[id]/page.tsx', 'src/app/layout.tsx', 'src/app/@modal/default.tsx'], 'the root @modal slot renders its default at every URL');
  assert.ok(d.routes.find((r) => r.pattern === '/dashboard').files.includes('src/app/dashboard/@team/page.tsx'), 'slot pages render with the page');
  assert.deepEqual(d.routes.find((r) => r.pattern === '/legacy/:slug').values, [{ slug: 'x1' }]);
  assert.ok(d.routes.find((r) => r.pattern === '/legacy/:slug').files.includes('src/pages/_app.tsx'));
});

test('Nuxt pages/: nested parents, optional and catch-all params, groups, definePageMeta path and layout', () => {
  const dir = tree({
    'package.json': pkg({ nuxt: '3' }), 'app.vue': '<template><NuxtPage/></template>', 'layouts/default.vue': '<template><slot/></template>', 'layouts/alt.vue': '<template><slot/></template>',
    'pages/index.vue': '<template/>', 'pages/(admin)/settings.vue': '<template/>', 'pages/products/[id].vue': '<template/>', 'pages/users/[[id]].vue': '<template/>',
    'pages/docs/[...slug].vue': '<template/>', 'pages/parent.vue': '<template><NuxtPage/></template>', 'pages/parent/index.vue': '<template/>', 'pages/parent/child.vue': '<template/>',
    'pages/post-[id].vue': '<template/>', 'pages/custom.vue': "<script setup>\ndefinePageMeta({ path: '/my-custom', layout: 'alt', middleware: ['auth'] })\n</script><template/>",
  });
  const d = discoverRoutes(dir);
  assert.deepEqual(patterns(d), ['/', '/docs/:slug*', '/my-custom', '/parent', '/parent/child', '/post-:id', '/products/:id', '/settings', '/users/:id?'].sort());
  const custom = d.routes.find((r) => r.pattern === '/my-custom');
  assert.ok(custom.files.includes('layouts/alt.vue') && custom.files.includes('app.vue'));
  assert.deepEqual(custom.guards, ["middleware: ['auth']"]);
  assert.ok(d.routes.find((r) => r.pattern === '/parent/child').files.includes('pages/parent.vue'));
  assert.equal(matchRoute(d.routes, '/post-12').route.pattern, '/post-:id');
  assert.equal(fillPattern('/post-:id', { id: 7 }), '/post-7');
});

test('SvelteKit, Astro, React Router 7 (routes.ts + flat routes), TanStack Router', () => {
  const sk = discoverRoutes(tree({
    'package.json': pkg({ '@sveltejs/kit': '2' }), 'src/app.html': '', 'src/routes/+page.svelte': '', 'src/routes/(app)/account/+page.svelte': '', 'src/routes/(app)/+layout.svelte': '',
    'src/routes/products/[id]/+page.svelte': '', 'src/routes/products/[id]/+page.ts': "export function entries() {\n  return [{ id: 'p1' }];\n}\n",
    'src/routes/lang/[[lang]]/about/+page.svelte': '', 'src/routes/files/[...path]/+page.svelte': '', 'src/routes/items/[id=integer]/+page.svelte': '', 'src/routes/api/+server.ts': '',
  }));
  assert.deepEqual(patterns(sk), ['/', '/account', '/files/:path*', '/items/:id', '/lang/:lang?/about', '/products/:id']);
  assert.deepEqual(sk.routes.find((r) => r.pattern === '/products/:id').values, [{ id: 'p1' }]);

  const astro = discoverRoutes(tree({
    'package.json': pkg({ astro: '5' }), 'src/pages/index.astro': '', 'src/pages/_hidden.astro': '', 'src/pages/about.md': '', 'src/pages/feed.xml.ts': '',
    'src/pages/blog/[slug].astro': "---\nexport function getStaticPaths() {\n  return [{ params: { slug: 'first' } }, { params: { slug: 'second' } }];\n}\n---\n<h1/>",
    'src/pages/docs/[...path].astro': '---\n---',
  }));
  assert.deepEqual(patterns(astro), ['/', '/about', '/blog/:slug', '/docs/:path*']);
  assert.deepEqual(astro.routes.find((r) => r.pattern === '/blog/:slug').values, [{ slug: 'first' }, { slug: 'second' }]);

  const rr = discoverRoutes(tree({
    'package.json': pkg({ '@react-router/dev': '7' }), 'app/root.tsx': P,
    'app/routes.ts': `import { type RouteConfig, index, route, layout, prefix } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";
export default [
  index("routes/home.tsx"),
  route("products/:id", "routes/product.tsx"),
  route("files/*", "routes/files.tsx"),
  layout("routes/auth.tsx", [route("login", "routes/login.tsx")]),
  route("dashboard", "routes/dash.tsx", [index("routes/dash-home.tsx"), route("settings", "routes/dash-settings.tsx")]),
  route("sitemap.xml", "routes/sitemap.ts"),
  ...prefix("v2", [route("x", "routes/x.tsx")]),
  ...(await flatRoutes({ rootDirectory: "fs" })),
] satisfies RouteConfig;
`,
    'app/routes/home.tsx': P, 'app/routes/product.tsx': P, 'app/routes/files.tsx': P, 'app/routes/auth.tsx': P, 'app/routes/login.tsx': P,
    'app/routes/dash.tsx': P, 'app/routes/dash-home.tsx': P, 'app/routes/dash-settings.tsx': P, 'app/routes/x.tsx': P,
    'app/routes/sitemap.ts': 'export function loader() {}',
    'app/fs/concerts.tsx': P, 'app/fs/concerts._index.tsx': P, 'app/fs/concerts.$city.tsx': P, 'app/fs/concerts_.mine.tsx': P,
    'app/fs/_auth.tsx': P, 'app/fs/_auth.signin.tsx': P, 'app/fs/($lang).faq.tsx': P, 'app/fs/shows.$id/route.tsx': P, 'app/fs/feed[.]json.ts': 'export function loader() {}',
  }));
  assert.deepEqual(patterns(rr), ['/', '/:lang?/faq', '/concerts', '/concerts/:city', '/concerts/mine', '/dashboard', '/dashboard/settings', '/files/:splat*', '/login', '/products/:id', '/shows/:id', '/signin', '/v2/x'].sort());
  assert.equal(rr.routes.find((r) => r.pattern === '/dashboard').file, 'app/routes/dash-home.tsx');
  assert.ok(rr.routes.find((r) => r.pattern === '/concerts/:city').files.includes('app/fs/concerts.tsx'));
  assert.ok(!rr.routes.find((r) => r.pattern === '/concerts/mine').files.includes('app/fs/concerts.tsx'), 'concerts_ opts out of the layout');

  const ts = discoverRoutes(tree({
    'package.json': pkg({ '@tanstack/react-router': '1' }), 'src/routes/__root.tsx': P, 'src/routes/index.tsx': P, 'src/routes/posts.tsx': P, 'src/routes/posts.index.tsx': P,
    'src/routes/posts.$postId.tsx': P, 'src/routes/_pathless.tsx': P, 'src/routes/_pathless/inside.tsx': P, 'src/routes/files/$.tsx': P, 'src/routes/(group)/grouped.tsx': P, 'src/routes/-components/x.tsx': P,
  }));
  assert.deepEqual(patterns(ts), ['/', '/files/:_splat*', '/grouped', '/inside', '/posts', '/posts/:postId'].sort());
});

test('React Router 7 with react-router-auto-routes (folders as segments, _layout, +colocated, .server)', () => {
  const d = discoverRoutes(tree({
    'package.json': pkg({ '@react-router/dev': '7' }), 'app/root.tsx': P,
    'app/routes.ts': "import { autoRoutes } from 'react-router-auto-routes'\nexport default autoRoutes({ ignoredRouteFiles: ['**/*.server.*'] })\n",
    'app/routes/_marketing/index.tsx': P, 'app/routes/_marketing/+logos/logos.ts': 'export const x = 1', 'app/routes/_auth/login.tsx': P, 'app/routes/_auth/login.server.ts': 'export const y = 1',
    'app/routes/users/index.tsx': P, 'app/routes/users/$username/notes/_layout.tsx': P, 'app/routes/users/$username/notes/$noteId.tsx': P, 'app/routes/users/$username/notes/$noteId_.edit.tsx': P,
    'app/routes/_seo/sitemap[.]xml.ts': 'export function loader() {}', 'app/routes/$.tsx': P,
  }));
  assert.deepEqual(patterns(d), ['/', '/:splat*', '/login', '/users', '/users/:username/notes/:noteId', '/users/:username/notes/:noteId/edit']);
  assert.ok(d.routes.find((r) => r.pattern === '/users/:username/notes/:noteId').files.includes('app/routes/users/$username/notes/_layout.tsx'));
});

test('config route arrays: Angular (lazy children, NgModule forChild, guards), Vue Router (spreads, imports, meta), React Router JSX', () => {
  const ng = discoverRoutes(tree({
    'package.json': pkg({ '@angular/core': '20', '@angular/router': '20' }),
    'src/app/app.config.ts': "import { provideRouter } from '@angular/router';\nimport { routes } from './app.routes';\nexport const appConfig = { providers: [provideRouter(routes)] };\n",
    'src/app/app.routes.ts': `import { Routes } from '@angular/router';
import { Home } from './home';
import { adminGuard } from './guard';
import { GEN } from './gen.routes';
export const routes: Routes = [
  { path: '', component: Home },
  { path: 'about', loadComponent: () => import('./about').then((m) => m.About) },
  { path: 'admin', canActivate: [adminGuard], loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES) },
  { path: 'legacy', loadChildren: () => import('./legacy/legacy.module').then((m) => m.LegacyModule) },
  { path: 'gen', children: GEN },
  { path: 'old', redirectTo: 'about' },
  { path: '**', component: Home },
];
`,
    'src/app/home.ts': 'export class Home {}', 'src/app/about.ts': 'export class About {}', 'src/app/guard.ts': 'export const adminGuard = () => true;',
    'src/app/gen.routes.ts': "export const GEN = [\n  { path: 'a/:id', loadComponent: () => import('./a').then((m) => m.A) },\n];\n", 'src/app/a.ts': 'export class A {}',
    'src/app/admin/admin.routes.ts': "import { AdminHome } from './home';\nexport const ADMIN_ROUTES = [\n  { path: '', component: AdminHome },\n  { path: 'users', loadComponent: () => import('./users').then((m) => m.Users) },\n];\n",
    'src/app/admin/home.ts': 'export class AdminHome {}', 'src/app/admin/users.ts': 'export class Users {}',
    'src/app/legacy/legacy.module.ts': "import { RouterModule } from '@angular/router';\nimport { Page } from './page';\n@NgModule({ imports: [RouterModule.forChild([{ path: '', component: Page }])] })\nexport class LegacyModule {}\n", 'src/app/legacy/page.ts': 'export class Page {}',
  }));
  assert.deepEqual(patterns(ng), ['/', '/about', '/admin', '/admin/users', '/gen/a/:id', '/legacy']);
  assert.deepEqual(ng.routes.find((r) => r.pattern === '/admin/users').guards, ['canActivate: [adminGuard]']);
  assert.equal(ng.routes.find((r) => r.pattern === '/admin/users').file, 'src/app/admin/users.ts');

  const vue = discoverRoutes(tree({
    'package.json': pkg({ vue: '3', 'vue-router': '4' }),
    'src/router/index.ts': `import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { extra } from './extra'
const more = [
  { path: '/more', component: () => import('../views/More.vue') }
]
export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/users/:id(\\\\d+)', component: () => import('../views/User.vue') },
    { path: '/admin', component: () => import('../views/Admin.vue'), meta: { requiresAuth: true, roles: ['admin'] }, children: [
      { path: '', component: () => import('../views/AdminHome.vue') },
      { path: 'users', component: () => import('../views/AdminUsers.vue') },
    ] },
    { path: '/old', redirect: '/' },
    ...more,
    ...extra,
    { path: '/:pathMatch(.*)*', component: () => import('../views/NotFound.vue') },
  ],
})
`,
    'src/router/extra.ts': "import X from '../views/X.vue'\nexport const extra = [{ path: '/x', component: X }]\n",
    ...Object.fromEntries(['HomeView', 'More', 'User', 'Admin', 'AdminHome', 'AdminUsers', 'NotFound', 'X'].map((n) => [`src/views/${n}.vue`, '<template/>'])),
  }));
  assert.deepEqual(patterns(vue), ['/', '/admin', '/admin/users', '/more', '/users/:id', '/x']);
  assert.ok(vue.routes.find((r) => r.pattern === '/admin/users').files.includes('src/views/Admin.vue'));
  assert.ok(vue.routes.find((r) => r.pattern === '/admin').guards.some((g) => /roles/.test(g)));

  const rr = discoverRoutes(tree({
    'package.json': pkg({ 'react-router-dom': '6' }),
    'src/App.tsx': `import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Shell from './pages/Shell';
import Order from './pages/Order';
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/app" element={<Shell />}>
        <Route path="orders/:orderId" element={<Order />} />
      </Route>
    </Routes>
  );
}
`,
    'src/pages/Home.tsx': P, 'src/pages/Shell.tsx': P, 'src/pages/Order.tsx': P,
  }));
  assert.deepEqual(patterns(rr), ['/', '/app', '/app/orders/:orderId'], 'a layout route renders at its own path too');
});

test('generateStaticParams that is not a literal yields no values (they come from the build manifest or links)', () => {
  assert.equal(staticParamsFrom('export function generateStaticParams() { return products.map((p) => ({ id: p.id })); }', 'generateStaticParams'), null);
});

test('matching URLs to routes: most specific route wins; grouping URLs without source', () => {
  const routes = [{ pattern: '/products/:id' }, { pattern: '/products/new' }, { pattern: '/docs/:slug+' }, { pattern: '/shop/:f*' }];
  assert.equal(matchRoute(routes, '/products/new').route.pattern, '/products/new');
  assert.deepEqual(matchRoute(routes, '/products/42').params, { id: '42' });
  assert.equal(matchRoute(routes, '/docs/a/b').route.pattern, '/docs/:slug+');
  assert.equal(matchRoute(routes, '/docs'), null);
  assert.equal(matchRoute(routes, '/shop').route.pattern, '/shop/:f*');
  const g = inferPatterns(['/blog/hello-world', '/blog/second-post', '/blog/third-one', '/about', '/u/123/edit', '/u/456/edit', '/orders/5f1c2e7a9b3d']);
  const pats = g.map((x) => x.pattern).sort();
  assert.deepEqual(pats, ['/about', '/blog/:slug', '/orders/:id', '/u/:id/edit']);
});

test('choosing instances: the bare URL of an optional route, the biggest candidate, then the first found', () => {
  const r = { dynamic: true, candidates: new Map([['/p/1', { source: 'link', order: 0 }], ['/p/2', { source: 'api', data: { name: 'x'.repeat(200) }, order: 1 }], ['/p/3', { source: 'link', order: 2 }]]) };
  assert.deepEqual(choose(r, 2), ['/p/2', '/p/1']);
});

test('coverage gate: minimum percentage and routes that were checked in the baseline', () => {
  const s = { urls: 10, routes: 3, percent: 66.7, counts: { checked: 2, 'needs-role': 1 }, list: [{ pattern: '/a', status: 'checked' }, { pattern: '/b', status: 'checked' }, { pattern: '/admin', status: 'needs-role' }] };
  assert.equal(coverageLine(s), '10 URL(s), 3 route(s): 2 checked, 1 need a role');
  assert.deepEqual(coverageGate(s, { min: 60 }), []);
  assert.equal(coverageGate(s, { min: 100 }).length, 1);
  assert.deepEqual(coverageGate(s, { baseline: { list: [{ pattern: '/admin', status: 'checked' }] } }), ['/admin was checked in the baseline and is now needs-role']);
});

test('import graph: barrels resolve to the defining module, lazy imports are per route, shell edits affect all', () => {
  const dir = tree({
    'package.json': pkg({ next: '16' }), 'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'src/app/layout.tsx': "import './globals.css';\nimport { Header } from '@/components';\n" + P, 'src/app/globals.css': '@import "./tokens.css";', 'src/app/tokens.css': '',
    'src/app/page.tsx': "import { Card } from '@/components';\n" + P,
    'src/app/products/[id]/page.tsx': "import { Price } from '@/components';\nimport data from '@/data/products.json';\nconst Chart = dynamic(() => import('@/components/Chart'));\n" + P,
    'src/app/blog/page.tsx': "import { readFileSync } from 'node:fs';\nconst posts = readFileSync('content/posts.json');\nexport default function B() { return <img src=\"/img/blog.png\" />; }\n",
    'src/components/index.ts': "export { Header } from './Header';\nexport * from './ui';\n", 'src/components/ui/index.ts': "export * from './Card';\nexport * from './Price';\n",
    'src/components/Header.tsx': P, 'src/components/ui/Card.tsx': "import styles from './Card.module.css';\nexport function Card() { return null; }\n", 'src/components/ui/Card.module.css': '',
    'src/components/ui/Price.tsx': "import { fmt } from '../../lib/fmt';\nexport function Price() { return null; }\n", 'src/lib/fmt.ts': 'export const fmt = 1;',
    'src/app/docs/layout.tsx': P, 'src/app/docs/[...slug]/page.tsx': P, 'docs/guide.md': '',
    'src/components/Chart.tsx': P, 'src/components/Unused.tsx': P, 'src/data/products.json': '[]', 'content/posts.json': '[]', 'public/img/blog.png': '',
  });
  const d = discoverRoutes(dir);
  const g = buildGraph(dir, { framework: d.framework, routes: d.routes, entries: shellEntries(dir, d.framework) });
  const cl = routeClosures(g);
  const idx = (p) => d.routes.findIndex((r) => r.pattern === p);
  const files = (p) => Array.from(cl.per[idx(p)], (f) => f.slice(dir.length + 1)).sort();
  assert.deepEqual(files('/'), ['src/app/globals.css', 'src/app/layout.tsx', 'src/app/page.tsx', 'src/app/tokens.css', 'src/components/Header.tsx', 'src/components/ui/Card.module.css', 'src/components/ui/Card.tsx']);
  assert.ok(files('/products/:id').includes('src/components/Chart.tsx') && files('/products/:id').includes('src/lib/fmt.ts') && !files('/products/:id').includes('src/components/ui/Card.tsx'));
  const sel = (changed) => { const a = affectedRoutes(g, changed, { closures: cl }); return a.all ? 'all' : Array.from(a.routes, (i) => d.routes[i].pattern).sort(); };
  assert.deepEqual(sel(['src/components/ui/Card.module.css']), ['/']);
  assert.deepEqual(sel(['src/lib/fmt.ts']), ['/products/:id']);
  assert.deepEqual(sel(['src/app/tokens.css']).length, 4, 'global CSS through the root layout: every route');
  assert.equal(sel(['next.config.ts']), 'all');
  assert.deepEqual(sel(['src/components/Unused.tsx']), [], 'nothing imports it');
  assert.deepEqual(sel(['public/img/blog.png']), ['/blog']);
  assert.deepEqual(sel(['content/posts.json']), ['/blog'], 'read with fs at runtime: the routes whose code names its folder');
  assert.equal(sel(['data/other/x.json']), 'all', 'nothing names its folder: every route');
  assert.deepEqual(sel(['src/components/Header.test.tsx']), []);
  assert.deepEqual(sel(['src/app/docs/layout.tsx']), ['/docs/:slug+'], 'a docs/ route folder is rendered, not documentation');
  assert.deepEqual(sel(['docs/guide.md']), [], 'docs/ at the project root is documentation');
});

test('Nuxt auto-imported components and composables are edges of the graph', () => {
  const dir = tree({
    'package.json': pkg({ nuxt: '3' }), 'app.vue': '<template><NuxtPage/></template>',
    'pages/index.vue': '<template><BaseButton/><lazy-product-card/></template><script setup>const p = usePrice()</script>',
    'pages/about.vue': '<template><p/></template>',
    'components/base/Button.vue': '<template/>', 'components/ProductCard.vue': '<template/>', 'composables/usePrice.ts': 'export function usePrice() {}',
  });
  const d = discoverRoutes(dir);
  const g = buildGraph(dir, { framework: 'nuxt', routes: d.routes, entries: shellEntries(dir, 'nuxt') });
  const a = affectedRoutes(g, ['components/base/Button.vue']);
  assert.deepEqual(Array.from(a.routes, (i) => d.routes[i].pattern), ['/']);
  assert.deepEqual(Array.from(affectedRoutes(g, ['composables/usePrice.ts']).routes, (i) => d.routes[i].pattern), ['/']);
  assert.ok(affectedRoutes(g, ['app.vue']).all);
});

test('TanStack generated route tree is used only when newer than the route files', () => {
  const dir = tree({
    'package.json': pkg({ '@tanstack/react-router': '1' }), 'src/routes/__root.tsx': P, 'src/routes/index.tsx': P, 'src/routes/about.tsx': P,
    'src/routeTree.gen.ts': "import { Route as rootRouteImport } from './routes/__root'\nimport { Route as IndexRouteImport } from './routes/index'\nexport interface FileRoutesByFullPath {\n  '/': typeof IndexRoute\n}\n",
  });
  const old = new Date(Date.now() - 60000);
  utimesSync(join(dir, 'src/routeTree.gen.ts'), old, old); // stale: about.tsx was added after it
  assert.deepEqual(patterns(discoverRoutes(dir)), ['/', '/about']);
});
