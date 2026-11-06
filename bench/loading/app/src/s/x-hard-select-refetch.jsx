import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
export default function Page() {
  const [src, setSrc] = useState('orders'); const [rows, setRows] = useState(null);
  useEffect(() => { fetch('/api/' + src + '?x=sel').then((r) => r.json()).then((d) => setRows(d.items)); }, [src]);
  return (
    <Shell title="Reports">
      <div className="row"><label>Dataset <select value={src} onChange={(e) => setSrc(e.target.value)}><option value="orders">Orders</option><option value="customers">Customers</option></select></label></div>
      <div className="card">{rows ? <OrdersTable rows={rows} /> : <p>Loading...</p>}</div>
    </Shell>
  );
}
