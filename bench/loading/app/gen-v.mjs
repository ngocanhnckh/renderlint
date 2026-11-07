// Scenarios for empty-state, dialog-focus, back-navigation and dropdown actions -> src/s/v-*.jsx, v.json
import { writeFileSync } from 'node:fs';
const H = "import { useEffect, useRef, useState } from 'react';\nimport { Link, useNavigate } from 'react-router';\nimport { useQuery } from '@tanstack/react-query';\nimport { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';\n";
const S = [];
const add = (id, rule, expect, desc, body) => S.push({ id, rule, expect, desc, body });
const useOrders = "const [d, set] = useState(null);\n  useEffect(() => { api('orders').then(set); }, []);";

// ---- empty-state
add('v-empty-good-msg', 'empty-state', 'ok', 'no orders -> "No orders yet" + Create order', `
export default function P() {
  ${useOrders}
  return <Shell title="Orders"><div className="card">{!d ? <SkeletonRows /> : d.items.length ? <OrdersTable rows={d.items} /> : <div><p>No orders yet</p><p>Orders show up here as soon as a customer checks out.</p><button className="btn primary">Create order</button></div>}</div></Shell>;
}`);
add('v-empty-good-rq', 'empty-state', 'ok', 'TanStack Query, "Nothing here yet" inside the card', `
export default function P() {
  const q = useQuery({ queryKey: ['customers'], queryFn: () => api('customers') });
  return <Shell title="Customers"><div className="card">{q.isPending ? <SkeletonRows /> : q.data.items.length === 0 ? <p>Nothing here yet. Invite your first customer.</p> : <OrdersTable rows={q.data.items} />}</div></Shell>;
}`);
add('v-empty-good-hidden', 'empty-state', 'ok', '"Recent activity" card left out entirely when empty, title and all', `
export default function P() {
  ${useOrders}
  return <Shell title="Dashboard"><div className="card"><h3>Your store</h3><p>Acme Goods, on the Pro plan.</p><p>Payouts every Monday.</p></div>{d && d.items.length > 0 && <div className="card"><h3>Recent activity</h3><OrdersTable rows={d.items.slice(0, 4)} /></div>}<div className="card"><h3>Need help?</h3><p>Our team answers in under an hour.</p></div></Shell>;
}`);
add('v-empty-good-onboarding', 'empty-state', 'ok', 'no orders -> sends the user to onboarding', `
export default function P() {
  const nav = useNavigate();
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then((x) => (x.items.length ? set(x) : nav('/s/v-welcome'))); }, []);
  return <Shell title="Orders"><div className="card">{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}`);
add('v-welcome', 'none', 'skip', 'target of onboarding', `
export default function P() { return <Shell title="Welcome"><div className="card"><p>Let's set up your store.</p></div></Shell>; }`);
add('v-empty-bad-table', 'empty-state', 'flag', 'no orders -> table headers only', `
export default function P() {
  ${useOrders}
  return <Shell title="Orders"><div className="card">{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}`);
add('v-empty-bad-cards', 'empty-state', 'flag', 'customer cards grid -> nothing under the heading', `
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('customers').then(set); }, []);
  return <Shell title="Customers"><div className="card"><h3>All customers</h3>{d ? <div className="cards">{d.items.map((c) => <div className="card" key={c.id}><b>{c.customer}</b><p>Customer since 2023</p><p>{c.status}</p></div>)}</div> : <SkeletonRows />}</div></Shell>;
}`);
add('v-empty-bad-crash', 'empty-state', 'flag', 'renders items[0].customer: crashes with no orders', `
export default function P() {
  ${useOrders}
  if (!d) return <Shell title="Orders"><div className="card"><SkeletonRows /></div></Shell>;
  return <Shell title="Orders"><div className="card"><p>Latest order from {d.items[0].customer}</p><OrdersTable rows={d.items} /></div></Shell>;
}`);
add('v-empty-bad-stuck', 'empty-state', 'flag', '!items.length treated as still loading: spinner forever', `
export default function P() {
  ${useOrders}
  return <Shell title="Orders"><div className="card">{d && d.items.length ? <OrdersTable rows={d.items} /> : <Spinner />}</div></Shell>;
}`);
add('v-empty-hard-count', 'empty-state', 'flag', '"Orders (0)" above an empty table: a count is not an empty state', `
export default function P() {
  ${useOrders}
  return <Shell title="Orders"><div className="card"><h3>Orders ({d ? d.items.length : '…'})</h3>{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}`);
add('v-empty-good-chart', 'empty-state', 'ok', 'a chart of plain numbers: not a list of records, left alone', `
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('chart').then(set); }, []);
  return <Shell title="Revenue"><div className="card"><h3>Last 7 days</h3>{d ? <div style={{ display: 'flex', gap: 8, alignItems: 'end', height: 160 }}>{d.bars.map((b, i) => <div key={i} style={{ width: 30, height: b * 1.5, background: '#2563eb' }} />)}</div> : <div style={{ height: 160 }}><SkeletonRows n={3} /></div>}</div></Shell>;
}`);

// ---- dialog-focus
const members = "<div className=\"card\"><p>Ada Byrne · Owner</p><p>Kenji Mori · Editor</p><p>Lena Fox · Viewer</p></div>";
add('v-dlg-bad-div', 'dialog-focus', 'flag', 'hand-made modal: no focus in, no Escape, focus lost on close', `
export default function P() {
  const [open, setOpen] = useState(false);
  return <Shell title="Team" actions={<button className="btn primary" onClick={() => setOpen(true)}>Invite member</button>}>${members}{open && <div className="modal-back"><div className="modal" role="dialog" aria-modal="true" aria-label="Invite member"><h3>Invite member</h3><label className="field">Email<input type="email" /></label><button className="btn" onClick={() => setOpen(false)}>Cancel</button></div></div>}</Shell>;
}`);
add('v-dlg-good-native', 'dialog-focus', 'ok', '<dialog> with showModal()', `
export default function P() {
  const ref = useRef(null);
  return <Shell title="Team" actions={<button className="btn primary" onClick={() => ref.current.showModal()}>Invite member</button>}>${members}<dialog className="modal" ref={ref}><h3>Invite member</h3><label className="field">Email<input type="email" /></label><form method="dialog"><button className="btn">Cancel</button></form></dialog></Shell>;
}`);
add('v-dlg-good-manual', 'dialog-focus', 'ok', 'React modal that focuses its field, closes on Escape, restores focus', `
export default function P() {
  const [open, setOpen] = useState(false);
  const btn = useRef(null), field = useRef(null);
  const close = () => { setOpen(false); setTimeout(() => btn.current && btn.current.focus()); };
  useEffect(() => { if (!open) return; field.current.focus(); const k = (e) => { if (e.key === 'Escape') close(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  return <Shell title="Team" actions={<button ref={btn} className="btn primary" onClick={() => setOpen(true)}>Invite member</button>}>${members}{open && <div className="modal-back"><div className="modal" role="dialog" aria-modal="true" aria-label="Invite member"><h3>Invite member</h3><label className="field">Email<input ref={field} type="email" /></label><button className="btn" onClick={close}>Cancel</button></div></div>}</Shell>;
}`);
add('v-dlg-bad-noescape', 'dialog-focus', 'flag', 'focuses its field and restores focus, but Escape does nothing', `
export default function P() {
  const [open, setOpen] = useState(false);
  const btn = useRef(null), field = useRef(null);
  const close = () => { setOpen(false); setTimeout(() => btn.current && btn.current.focus()); };
  useEffect(() => { if (open) field.current.focus(); }, [open]);
  return <Shell title="Team" actions={<button ref={btn} className="btn primary" onClick={() => setOpen(true)}>Invite member</button>}>${members}{open && <div className="modal-back"><div className="modal" role="dialog" aria-modal="true" aria-label="Invite member"><h3>Invite member</h3><label className="field">Email<input ref={field} type="email" /></label><button className="btn" onClick={close}>Close</button></div></div>}</Shell>;
}`);
add('v-dlg-bad-lostfocus', 'dialog-focus', 'flag', 'focus in and Escape work, focus is not returned on close', `
export default function P() {
  const [open, setOpen] = useState(false);
  const field = useRef(null);
  useEffect(() => { if (!open) return; field.current.focus(); const k = (e) => { if (e.key === 'Escape') setOpen(false); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  return <Shell title="Team" actions={<button className="btn primary" onClick={() => setOpen(true)}>Invite member</button>}>${members}{open && <div className="modal-back"><div className="modal" role="dialog" aria-modal="true" aria-label="Invite member"><h3>Invite member</h3><label className="field">Email<input ref={field} type="email" /></label><button className="btn" onClick={() => setOpen(false)}>Cancel</button></div></div>}</Shell>;
}`);
add('v-dlg-good-popover', 'dialog-focus', 'ok', 'a small role=dialog info popover (not a modal)', `
export default function P() {
  const [open, setOpen] = useState(false);
  return <Shell title="Team">${members}<div className="card" style={{ position: 'relative' }}><button className="btn" onClick={() => setOpen(!open)}>What are roles?</button>{open && <div className="pop" role="dialog" aria-label="Roles" style={{ top: 50, left: 16 }}>Owners can do everything.</div>}</div></Shell>;
}`);

// ---- back-navigation
add('v-back-target', 'none', 'skip', 'target page', `
export default function P() { return <Shell title="Invoices"><div className="card"><p>Invoice INV-2041 · $49.00 · Paid</p><p>Invoice INV-2040 · $49.00 · Paid</p><p>Invoice INV-2039 · $49.00 · Paid</p><p>Billing email: ada@example.com</p></div></Shell>; }`);
const home = "<div className=\"card\"><p>Welcome back, Ada.</p><p>3 projects are active.</p><p>2 invoices are due this week.</p><p>Your plan renews on May 1.</p></div>";
add('v-back-good-router', 'back-navigation', 'ok', '<Link> to another route', `
export default function P() { return <Shell title="Home" actions={<Link className="btn" to="/s/v-back-target">Invoices</Link>}>${home}</Shell>; }`);
add('v-back-bad-replace', 'back-navigation', 'flag', '<Link replace>: Back skips the page', `
export default function P() { return <Shell title="Home" actions={<Link className="btn" replace to="/s/v-back-target">Invoices</Link>}>${home}</Shell>; }`);
add('v-back-bad-pushstate', 'back-navigation', 'flag', 'history.pushState + local state: Back changes the URL, not the view', `
export default function P() {
  const [view, setView] = useState('home');
  const go = (e) => { e.preventDefault(); history.pushState(null, '', '/s/v-back-bad-pushstate/invoices'); setView('invoices'); };
  return <Shell title={view === 'home' ? 'Home' : 'Invoices'} actions={<a className="btn" href="/s/v-back-bad-pushstate/invoices" onClick={go}>Invoices</a>}>{view === 'home' ? ${home} : <div className="card"><p>Invoice INV-2041 · $49.00 · Paid</p><p>Invoice INV-2040 · $49.00 · Paid</p><p>Invoice INV-2039 · $49.00 · Paid</p><p>Billing email: ada@example.com</p></div>}</Shell>;
}`);
add('v-back-good-tabs', 'back-navigation', 'ok', 'tabs kept in ?tab= with replace (only the query changes)', `
export default function P() {
  const nav = useNavigate();
  const tab = new URLSearchParams(location.search).get('tab') || 'overview';
  return <Shell title="Project">{['overview', 'activity', 'settings'].map((t) => <Link key={t} className="btn" replace to={'?tab=' + t}>{t[0].toUpperCase() + t.slice(1)}</Link>)}<div className="card"><p>{tab === 'overview' ? 'Project Atlas, 12 tasks open.' : tab === 'activity' ? 'Ada closed 3 tasks today.' : 'Visibility: team only.'}</p></div></Shell>;
}`);

// ---- dropdown actions
add('v-sel-bad-filter', 'action-feedback', 'flag', 'status filter refetches, nothing shows it', `
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  const change = (e) => { const v = e.target.value; api('orders?status=' + v).then((x) => set({ items: x.items.filter((o) => !v || o.status.toLowerCase() === v) })); };
  return <Shell title="Orders" actions={<label>Status <select onChange={change}><option value="">All</option><option value="paid">Paid</option><option value="refunded">Refunded</option></select></label>}><div className="card">{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}`);
add('v-sel-good-filter', 'action-feedback', 'ok', 'status filter refetches, list dims with aria-busy', `
export default function P() {
  const [d, set] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { api('orders').then(set); }, []);
  const change = (e) => { const v = e.target.value; setBusy(true); api('orders?status=' + v).then((x) => set({ items: x.items.filter((o) => !v || o.status.toLowerCase() === v) })).finally(() => setBusy(false)); };
  return <Shell title="Orders" actions={<label>Status <select onChange={change}><option value="">All</option><option value="paid">Paid</option><option value="refunded">Refunded</option></select></label>}><div className={'card' + (busy ? ' dim' : '')} aria-busy={busy}>{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}`);
add('v-sel-good-local', 'action-feedback', 'ok', 'status filter applied locally (no request)', `
export default function P() {
  const [d, set] = useState(null), [f, setF] = useState('');
  useEffect(() => { api('orders').then(set); }, []);
  return <Shell title="Orders" actions={<label>Status <select onChange={(e) => setF(e.target.value)}><option value="">All</option><option value="Paid">Paid</option><option value="Refunded">Refunded</option></select></label>}><div className="card">{d ? <OrdersTable rows={d.items.filter((o) => !f || o.status === f)} /> : <SkeletonRows />}</div></Shell>;
}`);

for (const s of S) writeFileSync(new URL(`./src/s/${s.id}.jsx`, import.meta.url), H + s.body.trimStart() + '\n');
writeFileSync(new URL('./v.json', import.meta.url), JSON.stringify(S.filter((s) => s.expect !== 'skip').map(({ body, ...m }) => m), null, 1));
console.log(S.length, 'scenarios');
