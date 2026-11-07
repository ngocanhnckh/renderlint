import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders">{data && <div className="card"><OrdersTable rows={data.items} /></div>}</Shell>;
}
