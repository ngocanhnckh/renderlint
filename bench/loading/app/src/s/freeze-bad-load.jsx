import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
function heavy() { const t = performance.now(); let x = 0; while (performance.now() - t < 1200) x += Math.random(); return Math.round(x); }
export default function P() {
  const [v] = useState(heavy);
  return <Shell title="Forecast"><div className="card"><p>Forecast score {v}</p></div></Shell>;
}
