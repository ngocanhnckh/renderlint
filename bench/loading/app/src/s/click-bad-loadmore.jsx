import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
const first = [{ id: 1, customer: 'Ada Byrne', total: '$120.00', status: 'Paid' }];
export default function P() {
  const [rows, setRows] = useState(first);
  return <Shell title="Orders"><div className="card"><OrdersTable rows={rows} /><button className="btn" onClick={() => api('more').then((d) => setRows((r) => [...r, ...d.items]))}>Load more</button></div></Shell>;
}
