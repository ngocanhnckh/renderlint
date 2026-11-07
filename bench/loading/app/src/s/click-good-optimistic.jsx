import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [n, setN] = useState(12);
  return <Shell title="Post"><div className="card"><p>Our new checkout is live.</p><button className="btn" onClick={() => { setN(n + 1); post('like'); }}>Like ({n})</button></div></Shell>;
}
