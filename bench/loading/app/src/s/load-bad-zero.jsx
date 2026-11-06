import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data } = useFetch('stats');
  const s = data || { revenue: '$0', orders: '0', users: '0', churn: '0%' };
  return <Shell title="Dashboard"><Stats s={s} /><div className="card"><h3>Welcome back</h3><p>Here is how your store is doing this month.</p></div></Shell>;
}
