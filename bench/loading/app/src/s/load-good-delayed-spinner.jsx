import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data } = useFetch('orders');
  const [late, setLate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLate(true), 400); return () => clearTimeout(t); }, []);
  return <Shell title="Orders"><div className="card" style={{ minHeight: 120 }}>{data ? <OrdersTable rows={data.items} /> : late && <Spinner />}</div></Shell>;
}
