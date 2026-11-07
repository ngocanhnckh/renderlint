import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('customers').then(set); }, []);
  return <Shell title="Customers"><div className="card"><h3>All customers</h3>{d ? <div className="cards">{d.items.map((c) => <div className="card" key={c.id}><b>{c.customer}</b><p>Customer since 2023</p><p>{c.status}</p></div>)}</div> : <SkeletonRows />}</div></Shell>;
}
