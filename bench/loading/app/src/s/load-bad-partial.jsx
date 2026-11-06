import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
const STATIC = { revenue: '$48,210', orders: '1,204', users: '312', churn: '2.1%' };
export default function P() {
  const { data } = useFetch('orders');
  return <Shell title="Dashboard"><Stats s={STATIC} /><div className="card"><h3>Recent orders</h3>{data && <OrdersTable rows={data.items} />}</div></Shell>;
}
