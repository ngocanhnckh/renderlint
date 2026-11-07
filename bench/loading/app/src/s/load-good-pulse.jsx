import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data } = useFetch('stats');
  if (!data) return <Shell title="Dashboard"><div className="grid">{[1, 2, 3, 4].map((i) => <div key={i} className="card animate-pulse" style={{ height: 82, background: '#e5e7eb' }} />)}</div></Shell>;
  return <Shell title="Dashboard"><Stats s={data} /></Shell>;
}
