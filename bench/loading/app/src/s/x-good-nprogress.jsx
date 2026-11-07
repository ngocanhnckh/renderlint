import { useEffect, useRef, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
function useProgress() {
  const [p, setP] = useState(null); const t = useRef();
  const start = () => { setP(8); clearInterval(t.current); t.current = setInterval(() => setP((v) => (v < 90 ? v + (90 - v) * 0.1 : v)), 200); };
  const done = () => { clearInterval(t.current); setP(100); setTimeout(() => setP(null), 250); };
  return [p, start, done];
}
export default function Page() {
  const [p, start, done] = useProgress();
  const [tab, setTab] = useState('orders'); const [rows, setRows] = useState([]);
  const pick = (k) => { setTab(k); start(); fetch('/api/' + k + '?x=np').then((r) => r.json()).then((d) => { setRows(d.items); done(); }); };
  useEffect(() => { pick('orders'); }, []);
  return (
    <Shell title="Data">
      {p !== null && <div style={{ position: 'fixed', top: 0, left: 0, height: 2, width: p + '%', background: '#29d', boxShadow: '0 0 10px #29d', transition: 'width .2s' }} />}
      <div className="tabs">{['orders', 'customers'].map((k) => <button key={k} aria-selected={tab === k} onClick={() => pick(k)}>{k}</button>)}</div>
      <div className="card"><OrdersTable rows={rows} /></div>
    </Shell>
  );
}
