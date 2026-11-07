import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Orders"><div className="card">{data ? <OrdersTable rows={data.items} /> : <div role="status"><Spinner /><span className="sr-only">Loading orders</span></div>}</div></Shell>;
}
