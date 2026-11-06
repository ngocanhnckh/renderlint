import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [st, set] = useState({ s: 'loading' });
  const load = () => { set({ s: 'loading' }); fetch('/api/orders').then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then((d) => set({ s: 'ok', d }), () => set({ s: 'error' })); };
  useEffect(load, []);
  return <Shell title="Orders"><div className="card">{st.s === 'loading' ? <SkeletonRows /> : st.s === 'error' ? <p>Couldn't load orders. <button className="btn" onClick={load}>Try again</button></p> : <OrdersTable rows={st.d.items} />}</div></Shell>;
}
