import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
import { useQuery } from '@tanstack/react-query';
export default function P() {
  const { data, isPending } = useQuery({ queryKey: ['orders2'], queryFn: () => api('orders') });
  return <Shell title="Orders"><div className="card">{isPending ? <Spinner /> : <OrdersTable rows={data.items} />}</div></Shell>;
}
