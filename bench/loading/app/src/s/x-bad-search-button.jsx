import { useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
export default function Page() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const search = async () => { const r = await fetch('/api/orders?q=' + encodeURIComponent(q)); setRows((await r.json()).items); };
  return (
    <Shell title="Search orders">
      <div className="row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name" /><button className="btn primary" onClick={search}>Search</button></div>
      <div className="card">{rows ? <OrdersTable rows={rows} /> : <p>Enter a name and press Search.</p>}</div>
    </Shell>
  );
}
