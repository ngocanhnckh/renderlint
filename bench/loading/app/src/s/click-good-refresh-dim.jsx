import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data, loading, reload } = useFetch('orders');
  return <Shell title="Orders" actions={<button className="btn" onClick={reload}>Refresh</button>}><div className="card" aria-busy={loading}>{data ? <div className={loading ? 'dim' : ''}><p>Updated {data.updatedAt}</p><OrdersTable rows={data.items} /></div> : <SkeletonRows />}</div></Shell>;
}
