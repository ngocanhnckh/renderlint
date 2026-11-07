import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [tab, setTab] = useState({ name: 'orders', rows: null });
  useEffect(() => { api('orders').then((d) => setTab({ name: 'orders', rows: d.items })); }, []);
  const go = (name) => api(name).then((d) => setTab({ name, rows: d.items }));
  return <Shell title="Records"><div className="card"><div className="tabs" role="tablist">{['orders', 'customers'].map((n) => <button key={n} role="tab" aria-selected={tab.name === n} onClick={() => go(n)}>{n}</button>)}</div>{tab.rows ? <OrdersTable rows={tab.rows} /> : <SkeletonRows />}</div></Shell>;
}
