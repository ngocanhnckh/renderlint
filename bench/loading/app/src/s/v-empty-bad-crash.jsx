import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  if (!d) return <Shell title="Orders"><div className="card"><SkeletonRows /></div></Shell>;
  return <Shell title="Orders"><div className="card"><p>Latest order from {d.items[0].customer}</p><OrdersTable rows={d.items} /></div></Shell>;
}
