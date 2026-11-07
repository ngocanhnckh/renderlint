import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [r, setR] = useState(''); const [busy, setBusy] = useState(false);
  const gen = () => { setBusy(true); let left = 1500; const step = () => { const t = performance.now(); while (performance.now() - t < 12); left -= 16; if (left > 0) setTimeout(step, 0); else { setBusy(false); setR('Report ready'); } }; step(); };
  return <Shell title="Reports"><div className="card"><button className="btn" disabled={busy} onClick={gen}>{busy && <Spinner small />}Generate report</button><p>{r}</p></div></Shell>;
}
