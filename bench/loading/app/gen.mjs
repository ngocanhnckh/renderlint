// Writes one component file per scenario into src/s/, plus scenarios.json (the ground truth).
import { writeFileSync, mkdirSync } from 'node:fs';
const H = "import { useEffect, useState, Suspense, use } from 'react';\nimport { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';\n";
const S = [];
const add = (id, kind, expect, desc, body) => S.push({ id, kind, expect, desc, body });

// ---------- initial page load ----------
add('load-bad-null', 'load', 'flag', 'cards render only once data is there; blank meanwhile', `
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders">{data && <div className="card"><OrdersTable rows={data.items} /></div>}</Shell>;
}`);
add('load-bad-empty-table', 'load', 'flag', 'table header, empty body until data', `
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders"><div className="card"><OrdersTable rows={data ? data.items : []} /></div></Shell>;
}`);
add('load-bad-whole', 'load', 'flag', 'whole app renders null until /api/me: white page', `
export default function P() {
  const { data: me } = useFetch('me');
  const { data } = useFetch('orders');
  if (!me || !data) return null;
  return <Shell title={'Welcome, ' + me.name}><div className="card"><OrdersTable rows={data.items} /></div></Shell>;
}`);
add('load-bad-partial', 'load', 'flag', 'static stats, the Recent orders card body is empty until data', `
const STATIC = { revenue: '$48,210', orders: '1,204', users: '312', churn: '2.1%' };
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Dashboard"><Stats s={STATIC} /><div className="card"><h3>Recent orders</h3>{data && <OrdersTable rows={data.items} />}</div></Shell>;
}`);
add('load-bad-chart', 'load', 'flag', 'chart card keeps its height but stays empty until data', `
export default function P() {
  const { data } = useFetch('chart');
  return <Shell title="Revenue"><div className="card"><h3>Last 7 days</h3><div className="chart">{data && data.bars.map((h, i) => <i key={i} style={{ height: h + '%' }} />)}</div></div></Shell>;
}`);
add('load-bad-rq', 'load', 'flag', 'TanStack Query, data?.items.map, isPending ignored', `
import { useQuery } from '@tanstack/react-query';
export default function P() {
  const { data } = useQuery({ queryKey: ['orders'], queryFn: () => api('orders') });
  return <Shell title="Orders"><div className="card"><ul>{data?.items.map((o) => <li key={o.id}>#{o.id} {o.customer} - {o.total}</li>)}</ul></div></Shell>;
}`);
add('load-bad-zero', 'load', 'hard', 'stat cards show 0 until the real numbers arrive', `
export default function P() {
  const { data } = useFetch('stats');
  const s = data || { revenue: '$0', orders: '0', users: '0', churn: '0%' };
  return <Shell title="Dashboard"><Stats s={s} /><div className="card"><h3>Welcome back</h3><p>Here is how your store is doing this month.</p></div></Shell>;
}`);
add('load-good-skeleton', 'load', 'ok', 'shimmer skeleton rows (class "skeleton")', `
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders"><div className="card">{data ? <OrdersTable rows={data.items} /> : <SkeletonRows />}</div></Shell>;
}`);
add('load-good-skeleton-static', 'load', 'ok', 'grey placeholder blocks, no animation, hashed class name', `
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders"><div className="card">{data ? <OrdersTable rows={data.items} /> : <SkeletonRows cls="gph" />}</div></Shell>;
}`);
add('load-good-pulse', 'load', 'ok', 'Tailwind-style animate-pulse placeholder cards', `
export default function P() {
  const { data } = useFetch('stats');
  if (!data) return <Shell title="Dashboard"><div className="grid">{[1, 2, 3, 4].map((i) => <div key={i} className="card animate-pulse" style={{ height: 82, background: '#e5e7eb' }} />)}</div></Shell>;
  return <Shell title="Dashboard"><Stats s={data} /></Shell>;
}`);
add('load-good-spinner', 'load', 'ok', 'spinning ring, hashed class name, no text, no ARIA', `
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders"><div className="card">{data ? <OrdersTable rows={data.items} /> : <Spinner />}</div></Shell>;
}`);
add('load-good-spinner-aria', 'load', 'ok', 'role=status with visually hidden "Loading orders"', `
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders"><div className="card">{data ? <OrdersTable rows={data.items} /> : <div role="status"><Spinner /><span className="sr-only">Loading orders</span></div>}</div></Shell>;
}`);
add('load-good-text', 'load', 'ok', 'plain "Loading orders..." paragraph', `
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders"><div className="card">{data ? <OrdersTable rows={data.items} /> : <p style={{ color: '#6b7280' }}>Loading orders...</p>}</div></Shell>;
}`);
add('load-good-suspense', 'load', 'ok', 'React 19 use() + Suspense with a skeleton fallback', `
let p;
function Rows() { p = p || api('orders'); const d = use(p); return <OrdersTable rows={d.items} />; }
export default function P() {
  return <Shell title="Orders"><div className="card"><Suspense fallback={<SkeletonRows />}><Rows /></Suspense></div></Shell>;
}`);
add('load-good-rq', 'load', 'ok', 'TanStack Query with isPending -> spinner', `
import { useQuery } from '@tanstack/react-query';
export default function P() {
  const { data, isPending } = useQuery({ queryKey: ['orders2'], queryFn: () => api('orders') });
  return <Shell title="Orders"><div className="card">{isPending ? <Spinner /> : <OrdersTable rows={data.items} />}</div></Shell>;
}`);
add('load-good-global-bar', 'load', 'ok', 'a top progress bar while requests run, content area empty', `
export default function P() {
  const { data } = useFetch('orders');
  return <>{!data && <div className="topbar" />}<Shell title="Orders">{data && <div className="card"><OrdersTable rows={data.items} /></div>}</Shell></>;
}`);
add('load-good-delayed-spinner', 'load', 'ok', 'spinner shown only after 400ms, to avoid a flash on fast responses', `
export default function P() {
  const { data } = useFetch('orders');
  const [late, setLate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLate(true), 400); return () => clearTimeout(t); }, []);
  return <Shell title="Orders"><div className="card" style={{ minHeight: 120 }}>{data ? <OrdersTable rows={data.items} /> : late && <Spinner />}</div></Shell>;
}`);
add('load-good-static', 'load', 'ok', 'no request at all', `
export default function P() {
  return <Shell title="Help"><div className="card"><h3>Getting started</h3><p>Connect your store, invite your team and set up payouts.</p></div></Shell>;
}`);
add('load-good-background', 'load', 'ok', 'polls /api/ping and posts analytics; the UI does not depend on them', `
export default function P() {
  useEffect(() => { post('collect', { e: 'view' }); const t = setInterval(() => api('ping'), 1000); return () => clearInterval(t); }, []);
  return <Shell title="Help"><div className="card"><h3>Getting started</h3><p>Connect your store, invite your team and set up payouts.</p></div></Shell>;
}`);
add('load-good-badge', 'load', 'ok', 'static page; a tiny notification count appears late', `
export default function P() {
  const { data } = useFetch('notifications');
  return <Shell title={<>Inbox{data && <span className="badge">{data.count}</span>}</>}><div className="card"><h3>Getting started</h3><p>Connect your store, invite your team and set up payouts.</p></div></Shell>;
}`);
add('load-good-initial-data', 'load', 'ok', 'renders cached data at once, refetches silently (stale-while-revalidate)', `
const CACHE = { items: [{ id: 1040, customer: 'Ada Byrne', total: '$120.00', status: 'Paid' }, { id: 1041, customer: 'Kenji Mori', total: '$157.00', status: 'Pending' }, { id: 1042, customer: 'Lena Fox', total: '$194.00', status: 'Refunded' }], updatedAt: 'cached' };
export default function P() {
  const { data } = useFetch('orders');
  const d = data || CACHE;
  return <Shell title="Orders"><div className="card"><p>Updated {d.updatedAt}</p><OrdersTable rows={d.items} /></div></Shell>;
}`);

// ---------- clicks that fetch ----------
add('click-bad-refresh', 'click', 'flag', 'Refresh refetches; nothing changes until the data arrives', `
export default function P() {
  const { data, reload } = useFetch('orders');
  return <Shell title="Orders" actions={<button className="btn" onClick={reload}>Refresh</button>}><div className="card">{data ? <><p>Updated {data.updatedAt}</p><OrdersTable rows={data.items} /></> : <SkeletonRows />}</div></Shell>;
}`);
add('click-bad-loadmore', 'click', 'flag', 'Load more appends rows; no feedback meanwhile', `
const first = [{ id: 1, customer: 'Ada Byrne', total: '$120.00', status: 'Paid' }];
export default function P() {
  const [rows, setRows] = useState(first);
  return <Shell title="Orders"><div className="card"><OrdersTable rows={rows} /><button className="btn" onClick={() => api('more').then((d) => setRows((r) => [...r, ...d.items]))}>Load more</button></div></Shell>;
}`);
add('click-bad-save', 'click', 'flag', 'Save POSTs; button stays enabled, a toast comes after', `
export default function P() {
  const [msg, setMsg] = useState('');
  const save = (e) => { e.preventDefault(); post('settings', {}).then(() => setMsg('Settings saved')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input defaultValue="Acme" /></label><button className="btn primary">Save changes</button></form>{msg && <div className="toast">{msg}</div>}</Shell>;
}`);
add('click-bad-tabs-frozen', 'click', 'flag', 'tab switch waits for the data, even the tab highlight', `
export default function P() {
  const [tab, setTab] = useState({ name: 'orders', rows: null });
  useEffect(() => { api('orders').then((d) => setTab({ name: 'orders', rows: d.items })); }, []);
  const go = (name) => api(name).then((d) => setTab({ name, rows: d.items }));
  return <Shell title="Records"><div className="card"><div className="tabs" role="tablist">{['orders', 'customers'].map((n) => <button key={n} role="tab" aria-selected={tab.name === n} onClick={() => go(n)}>{n}</button>)}</div>{tab.rows ? <OrdersTable rows={tab.rows} /> : <SkeletonRows />}</div></Shell>;
}`);
add('click-hard-tabs-stale', 'click', 'hard', 'tab highlight moves at once, the old tab content stays until data', `
export default function P() {
  const [name, setName] = useState('orders');
  const [rows, setRows] = useState(null);
  useEffect(() => { api(name).then((d) => setRows(d.items)); }, [name]);
  return <Shell title="Records"><div className="card"><div className="tabs" role="tablist">{['orders', 'customers'].map((n) => <button key={n} role="tab" aria-selected={name === n} onClick={() => setName(n)}>{n}</button>)}</div>{rows ? <OrdersTable rows={rows} /> : <SkeletonRows />}</div></Shell>;
}`);
add('click-good-refresh', 'click', 'ok', 'Refresh disables itself and shows a small spinner', `
export default function P() {
  const { data, loading, reload } = useFetch('orders');
  return <Shell title="Orders" actions={<button className="btn" disabled={loading} onClick={reload}>{loading && <Spinner small />}Refresh</button>}><div className="card">{data ? <><p>Updated {data.updatedAt}</p><OrdersTable rows={data.items} /></> : <SkeletonRows />}</div></Shell>;
}`);
add('click-good-refresh-dim', 'click', 'ok', 'Refresh dims the stale table with aria-busy', `
export default function P() {
  const { data, loading, reload } = useFetch('orders');
  return <Shell title="Orders" actions={<button className="btn" onClick={reload}>Refresh</button>}><div className="card" aria-busy={loading}>{data ? <div className={loading ? 'dim' : ''}><p>Updated {data.updatedAt}</p><OrdersTable rows={data.items} /></div> : <SkeletonRows />}</div></Shell>;
}`);
add('click-good-save', 'click', 'ok', 'Save becomes "Saving..." and disabled', `
export default function P() {
  const [st, setSt] = useState('idle');
  const save = (e) => { e.preventDefault(); setSt('saving'); post('settings', {}).then(() => setSt('saved')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input defaultValue="Acme" /></label><button className="btn primary" disabled={st === 'saving'}>{st === 'saving' ? 'Saving...' : 'Save changes'}</button>{st === 'saved' && <div className="toast">Settings saved</div>}</form></Shell>;
}`);
add('click-good-tabs', 'click', 'ok', 'tab switch shows a skeleton in the panel', `
export default function P() {
  const [name, setName] = useState('orders');
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api(name).then((d) => setRows(d.items)); }, [name]);
  return <Shell title="Records"><div className="card"><div className="tabs" role="tablist">{['orders', 'customers'].map((n) => <button key={n} role="tab" aria-selected={name === n} onClick={() => setName(n)}>{n}</button>)}</div>{rows ? <OrdersTable rows={rows} /> : <SkeletonRows />}</div></Shell>;
}`);
add('click-good-local', 'click', 'ok', 'a button that only toggles local UI', `
export default function P() {
  const [open, setOpen] = useState(false);
  return <Shell title="Help"><div className="card"><button className="btn" onClick={() => setOpen(!open)}>Show details</button>{open && <p>Payouts are sent every Monday.</p>}</div></Shell>;
}`);
add('click-good-optimistic', 'click', 'ok', 'Like count goes up at once, the POST runs in the background', `
export default function P() {
  const [n, setN] = useState(12);
  return <Shell title="Post"><div className="card"><p>Our new checkout is live.</p><button className="btn" onClick={() => { setN(n + 1); post('like'); }}>Like ({n})</button></div></Shell>;
}`);
add('click-good-analytics', 'click', 'ok', 'opens a local panel and sends an analytics event', `
export default function P() {
  const [open, setOpen] = useState(false);
  return <Shell title="Help"><div className="card"><button className="btn" onClick={() => { setOpen(true); post('collect', { e: 'help' }); }}>Contact support</button>{open && <p>Email us at help@acme.test</p>}</div></Shell>;
}`);

// ---------- freezes (main thread blocked) ----------
add('freeze-bad-click', 'freeze', 'flag', '"Generate report" blocks the main thread for 1.5s', `
export default function P() {
  const [r, setR] = useState('');
  const gen = () => { const t = performance.now(); let x = 0; while (performance.now() - t < 1500) x += Math.random(); setR('Report ready (' + Math.round(x) + ')'); };
  return <Shell title="Reports"><div className="card"><button className="btn" onClick={gen}>Generate report</button><p>{r}</p></div></Shell>;
}`);
add('freeze-bad-load', 'freeze', 'flag', 'a 1.2s synchronous computation while mounting', `
function heavy() { const t = performance.now(); let x = 0; while (performance.now() - t < 1200) x += Math.random(); return Math.round(x); }
export default function P() {
  const [v] = useState(heavy);
  return <Shell title="Forecast"><div className="card"><p>Forecast score {v}</p></div></Shell>;
}`);
add('freeze-good-chunks', 'freeze', 'ok', 'the same work in 16ms chunks, with a spinner', `
export default function P() {
  const [r, setR] = useState(''); const [busy, setBusy] = useState(false);
  const gen = () => { setBusy(true); let left = 1500; const step = () => { const t = performance.now(); while (performance.now() - t < 12); left -= 16; if (left > 0) setTimeout(step, 0); else { setBusy(false); setR('Report ready'); } }; step(); };
  return <Shell title="Reports"><div className="card"><button className="btn" disabled={busy} onClick={gen}>{busy && <Spinner small />}Generate report</button><p>{r}</p></div></Shell>;
}`);

mkdirSync(new URL('./src/s/', import.meta.url), { recursive: true });
for (const s of S) writeFileSync(new URL(`./src/s/${s.id}.jsx`, import.meta.url), (s.body.includes("from '@tanstack") ? H : H) + s.body.trimStart() + '\n');
const meta = S.map(({ body, ...m }) => m);
// route transitions and vanilla live in main.jsx / vanilla.html
meta.push(
  { id: 'vanilla-bad', kind: 'load', expect: 'flag', desc: 'plain HTML + fetch().then(innerHTML), empty tbody meanwhile', url: '/vanilla.html' },
  { id: 'route-bad-loader', kind: 'route', expect: 'flag', desc: 'React Router data loader; old page stays, no pending UI' },
  { id: 'route-good-loader', kind: 'route', expect: 'ok', desc: 'same, with useNavigation(): top bar + dimmed page' },
  { id: 'route-bad-blank', kind: 'route', expect: 'flag', desc: 'route component fetches in an effect, renders nothing until data' },
  { id: 'route-good-skeleton', kind: 'route', expect: 'ok', desc: 'route component fetches in an effect, skeleton meanwhile' },
);
writeFileSync(new URL('./scenarios.json', import.meta.url), JSON.stringify(meta, null, 1));
console.log(meta.length, 'scenarios');
