import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data } = useFetch('notifications');
  return <Shell title={<>Inbox{data && <span className="badge">{data.count}</span>}</>}><div className="card"><h3>Getting started</h3><p>Connect your store, invite your team and set up payouts.</p></div></Shell>;
}
