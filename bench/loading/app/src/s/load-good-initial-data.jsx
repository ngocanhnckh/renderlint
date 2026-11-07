import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
const CACHE = { items: [{ id: 1040, customer: 'Ada Byrne', total: '$120.00', status: 'Paid' }, { id: 1041, customer: 'Kenji Mori', total: '$157.00', status: 'Pending' }, { id: 1042, customer: 'Lena Fox', total: '$194.00', status: 'Refunded' }], updatedAt: 'cached' };
export default function P() {
  const { data } = useFetch('orders');
  const d = data || CACHE;
  return <Shell title="Orders"><div className="card"><p>Updated {d.updatedAt}</p><OrdersTable rows={d.items} /></div></Shell>;
}
