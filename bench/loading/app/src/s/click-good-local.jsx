import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [open, setOpen] = useState(false);
  return <Shell title="Help"><div className="card"><button className="btn" onClick={() => setOpen(!open)}>Show details</button>{open && <p>Payouts are sent every Monday.</p>}</div></Shell>;
}
