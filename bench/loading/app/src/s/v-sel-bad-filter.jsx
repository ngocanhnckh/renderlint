import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  const change = (e) => { const v = e.target.value; api('orders?status=' + v).then((x) => set({ items: x.items.filter((o) => !v || o.status.toLowerCase() === v) })); };
  return <Shell title="Orders" actions={<label>Status <select onChange={change}><option value="">All</option><option value="paid">Paid</option><option value="refunded">Refunded</option></select></label>}><div className="card">{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}
