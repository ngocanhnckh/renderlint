import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  return <Shell title="Orders"><div className="card">{!d ? <SkeletonRows /> : d.items.length ? <OrdersTable rows={d.items} /> : <div><p>No orders yet</p><p>Orders show up here as soon as a customer checks out.</p><button className="btn primary">Create order</button></div>}</div></Shell>;
}
