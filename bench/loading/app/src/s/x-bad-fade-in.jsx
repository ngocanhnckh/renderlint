import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
export default function Page() {
  const [rows, setRows] = useState([]);
  const [shown, setShown] = useState(false);
  useEffect(() => { fetch('/api/orders?x=fade').then((r) => r.json()).then((d) => { setRows(d.items); requestAnimationFrame(() => setShown(true)); }); }, []);
  return <Shell title="Orders"><div className="card" style={{ opacity: shown ? 1 : 0, transition: 'opacity .4s', minHeight: 300 }}><OrdersTable rows={rows} /></div></Shell>;
}
