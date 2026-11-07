import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('me?delay=2500').then(() => api('orders?delay=2500')).then(set); }, []);
  return <Shell title="Orders">{d ? <div className="card" style={{ minHeight: 500 }}><p style={{ fontSize: 20 }}>This month you processed 1,204 orders from 312 customers, with revenue up 12% on last month. Refunds stayed under 2% and the average order value rose to $40.04. Your top region was the Pacific Northwest.</p><OrdersTable rows={d.items} /></div> : <SkeletonRows />}</Shell>;
}
