import { useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
export default function Page() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const show = () => { setOpen(true); fetch('/api/orders?x=drawer').then((r) => r.json()).then((d) => setRows(d.items)); };
  return (
    <Shell title="Customer">
      <div className="card"><button className="btn" onClick={show}>Order history</button></div>
      {open && (
        <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, background: '#fff', boxShadow: '-4px 0 16px rgba(0,0,0,.2)', padding: 20 }}>
          <div className="top"><h3>Order history</h3><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
          {rows.length > 0 && <OrdersTable rows={rows} />}
        </aside>
      )}
    </Shell>
  );
}
