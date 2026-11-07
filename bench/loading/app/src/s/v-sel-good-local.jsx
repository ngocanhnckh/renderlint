import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null), [f, setF] = useState('');
  useEffect(() => { api('orders').then(set); }, []);
  return <Shell title="Orders" actions={<label>Status <select onChange={(e) => setF(e.target.value)}><option value="">All</option><option value="Paid">Paid</option><option value="Refunded">Refunded</option></select></label>}><div className="card">{d ? <OrdersTable rows={d.items.filter((o) => !f || o.status === f)} /> : <SkeletonRows />}</div></Shell>;
}
