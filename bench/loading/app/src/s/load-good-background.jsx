import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  useEffect(() => { post('collect', { e: 'view' }); const t = setInterval(() => api('ping'), 1000); return () => clearInterval(t); }, []);
  return <Shell title="Help"><div className="card"><h3>Getting started</h3><p>Connect your store, invite your team and set up payouts.</p></div></Shell>;
}
