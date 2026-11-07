import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { fetch('/api/orders').then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then(set).catch(() => {}); }, []);
  return <Shell title="Orders"><div className="card">{d ? <OrdersTable rows={d.items} /> : <Spinner />}</div></Shell>;
}
