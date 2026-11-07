import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
import { useQuery } from '@tanstack/react-query';
export default function P() {
  const { data } = useQuery({ queryKey: ['orders'], queryFn: () => api('orders') });
  return <Shell title="Orders"><div className="card"><ul>{data?.items.map((o) => <li key={o.id}>#{o.id} {o.customer} - {o.total}</li>)}</ul></div></Shell>;
}
