import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const nav = useNavigate();
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then((x) => (x.items.length ? set(x) : nav('/s/v-welcome'))); }, []);
  return <Shell title="Orders"><div className="card">{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}
