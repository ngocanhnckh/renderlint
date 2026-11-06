import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [r, setR] = useState('');
  const gen = () => { const t = performance.now(); let x = 0; while (performance.now() - t < 1500) x += Math.random(); setR('Report ready (' + Math.round(x) + ')'); };
  return <Shell title="Reports"><div className="card"><button className="btn" onClick={gen}>Generate report</button><p>{r}</p></div></Shell>;
}
