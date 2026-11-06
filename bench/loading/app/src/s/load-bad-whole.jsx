import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data: me } = useFetch('me');
  const { data } = useFetch('orders');
  if (!me || !data) return null;
  return <Shell title={'Welcome, ' + me.name}><div className="card"><OrdersTable rows={data.items} /></div></Shell>;
}
