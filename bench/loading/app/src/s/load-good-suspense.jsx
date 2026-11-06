import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
let p;
function Rows() { p = p || api('orders'); const d = use(p); return <OrdersTable rows={d.items} />; }
export default function P() {
  return <Shell title="Orders"><div className="card"><Suspense fallback={<SkeletonRows />}><Rows /></Suspense></div></Shell>;
}
