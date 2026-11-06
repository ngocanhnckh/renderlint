import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
export default function Page() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const load = () => { setBusy(true); return fetch('/api/orders?x=ov').then((r) => r.json()).then((d) => { setRows(d.items); setBusy(false); }); };
  useEffect(() => { load(); }, []);
  return (
    <Shell title="Orders" actions={<button className="btn" onClick={load}>Reload</button>}>
      <div className="card"><OrdersTable rows={rows} /></div>
      {busy && <div style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,.7)', display: 'grid', placeItems: 'center', fontWeight: 600 }}>Please wait...</div>}
    </Shell>
  );
}
