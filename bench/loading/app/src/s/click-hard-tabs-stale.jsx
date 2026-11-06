import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [name, setName] = useState('orders');
  const [rows, setRows] = useState(null);
  useEffect(() => { api(name).then((d) => setRows(d.items)); }, [name]);
  return <Shell title="Records"><div className="card"><div className="tabs" role="tablist">{['orders', 'customers'].map((n) => <button key={n} role="tab" aria-selected={name === n} onClick={() => setName(n)}>{n}</button>)}</div>{rows ? <OrdersTable rows={rows} /> : <SkeletonRows />}</div></Shell>;
}
