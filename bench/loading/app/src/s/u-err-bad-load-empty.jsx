import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [rows, set] = useState(null);
  useEffect(() => { fetch('/api/orders').then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then((d) => set(d.items)).catch(() => set([])); }, []);
  return <Shell title="Orders"><div className="card">{rows ? <OrdersTable rows={rows} /> : <SkeletonRows />}</div></Shell>;
}
