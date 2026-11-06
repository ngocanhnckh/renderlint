import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data, reload } = useFetch('orders');
  return <Shell title="Orders" actions={<button className="btn" onClick={reload}>Refresh</button>}><div className="card">{data ? <><p>Updated {data.updatedAt}</p><OrdersTable rows={data.items} /></> : <SkeletonRows />}</div></Shell>;
}
