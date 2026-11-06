// UX-mode scenarios (error handling, dead buttons, double submit, layout shift, slow render) -> src/s/u-*.jsx, ux.json
import { writeFileSync } from 'node:fs';
const H = "import { useEffect, useState } from 'react';\nimport { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';\n";
const S = [];
const add = (id, rule, expect, desc, body) => S.push({ id, rule, expect, desc, body });
const get = (p) => `fetch('/api/${p}').then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))`;

add('u-err-good-load', 'error-feedback', 'ok', 'load failure -> "Couldn\'t load orders" + Retry', `
export default function P() {
  const [st, set] = useState({ s: 'loading' });
  const load = () => { set({ s: 'loading' }); ${get('orders')}.then((d) => set({ s: 'ok', d }), () => set({ s: 'error' })); };
  useEffect(load, []);
  return <Shell title="Orders"><div className="card">{st.s === 'loading' ? <SkeletonRows /> : st.s === 'error' ? <p>Couldn't load orders. <button className="btn" onClick={load}>Try again</button></p> : <OrdersTable rows={st.d.items} />}</div></Shell>;
}`);
add('u-err-bad-load-stuck', 'error-feedback', 'flag', 'load failure is ignored: the spinner spins forever', `
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { ${get('orders')}.then(set).catch(() => {}); }, []);
  return <Shell title="Orders"><div className="card">{d ? <OrdersTable rows={d.items} /> : <Spinner />}</div></Shell>;
}`);
add('u-err-bad-load-empty', 'error-feedback', 'flag', 'load failure -> empty table, no message', `
export default function P() {
  const [rows, set] = useState(null);
  useEffect(() => { ${get('orders')}.then((d) => set(d.items)).catch(() => set([])); }, []);
  return <Shell title="Orders"><div className="card">{rows ? <OrdersTable rows={rows} /> : <SkeletonRows />}</div></Shell>;
}`);
add('u-err-good-save', 'error-feedback', 'ok', 'Save failure -> toast "Couldn\'t save"', `
export default function P() {
  const [st, setSt] = useState('idle');
  const save = (e) => { e.preventDefault(); setSt('saving'); fetch('/api/settings', { method: 'POST' }).then((r) => setSt(r.ok ? 'saved' : 'failed'), () => setSt('failed')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input name="store" required /></label><label className="field">Email<input name="email" type="email" required /></label><button className="btn primary" disabled={st === 'saving'}>{st === 'saving' ? 'Saving...' : 'Save changes'}</button></form>{st === 'saved' && <div className="toast">Settings saved</div>}{st === 'failed' && <div className="toast" role="alert">Couldn't save your settings. Try again.</div>}</Shell>;
}`);
add('u-err-bad-save', 'error-feedback', 'flag', 'Save shows "Saving..." then silently resets on failure', `
export default function P() {
  const [st, setSt] = useState('idle');
  const save = (e) => { e.preventDefault(); setSt('saving'); fetch('/api/settings', { method: 'POST' }).then((r) => { if (!r.ok) throw new Error('save'); setSt('saved'); }).catch(() => setSt('idle')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input name="store" required /></label><button className="btn primary" disabled={st === 'saving'}>{st === 'saving' ? 'Saving...' : 'Save changes'}</button>{st === 'saved' && <div className="toast">Settings saved</div>}</form></Shell>;
}`);
add('u-dead-bad', 'dead-control', 'flag', '"Export CSV" button with an empty handler', `
export default function P() {
  return <Shell title="Reports" actions={<button className="btn" onClick={() => {}}>Export CSV</button>}><div className="card"><p>Monthly revenue report.</p></div></Shell>;
}`);
add('u-dead-good-copy', 'dead-control', 'ok', '"Copy link" changes to "Copied!"', `
export default function P() {
  const [c, setC] = useState(false);
  return <Shell title="Share"><div className="card"><p>https://acme.test/r/42</p><button className="btn" onClick={() => { navigator.clipboard && navigator.clipboard.writeText('x').catch(() => {}); setC(true); }}>{c ? 'Copied!' : 'Copy link'}</button></div></Shell>;
}`);
add('u-double-bad', 'double-submit', 'flag', '"Place order" stays enabled while pending', `
export default function P() {
  const [done, setDone] = useState(false);
  return <Shell title="Checkout"><div className="card"><p>Total $42.00</p><button className="btn primary" onClick={() => post('orders').then(() => setDone(true))}>Place order</button>{done && <p>Order placed</p>}</div></Shell>;
}`);
add('u-shift-bad', 'layout-shift', 'flag', 'a 240px promo banner is inserted above the table after data arrives', `
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  return <Shell title="Orders">{d && <div className="card" style={{ height: 240, background: '#fef3c7' }}><h3>New: bulk export</h3></div>}<div className="card"><OrdersTable rows={[{ id: 1, customer: 'Ada Byrne', total: '$120.00', status: 'Paid' }, { id: 2, customer: 'Kenji Mori', total: '$157.00', status: 'Paid' }, { id: 3, customer: 'Lena Fox', total: '$194.00', status: 'Paid' }, { id: 4, customer: 'Omar Haddad', total: '$231.00', status: 'Paid' }]} /></div><div className="card"><p>Need help? Contact support.</p></div></Shell>;
}`);
add('u-slow-bad', 'slow-render', 'flag', 'main content waits on a 2.5s request chained after a 2.5s request', `
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('me?delay=2500').then(() => api('orders?delay=2500')).then(set); }, []);
  return <Shell title="Orders">{d ? <div className="card" style={{ minHeight: 500 }}><p style={{ fontSize: 20 }}>This month you processed 1,204 orders from 312 customers, with revenue up 12% on last month. Refunds stayed under 2% and the average order value rose to $40.04. Your top region was the Pacific Northwest.</p><OrdersTable rows={d.items} /></div> : <SkeletonRows />}</Shell>;
}`);

for (const s of S) writeFileSync(new URL(`./src/s/${s.id}.jsx`, import.meta.url), H + s.body.trimStart() + '\n');
writeFileSync(new URL('./ux.json', import.meta.url), JSON.stringify(S.map(({ body, ...m }) => m), null, 1));
console.log(S.length, 'ux scenarios');
