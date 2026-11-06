import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
export default function Page() {
  const [page, setPage] = useState(1);
  const [view, setView] = useState(null);
  useEffect(() => {
    if (!view) { setPage(1); fetch('/api/orders?page=1').then((r) => r.json()).then((d) => setView({ page: 1, rows: d.items })); }
  }, []);
  const go = (n) => fetch('/api/orders?page=' + n).then((r) => r.json()).then((d) => setView({ page: n, rows: d.items }));
  if (!view) return <Shell title="Orders"><p>Loading...</p></Shell>;
  return (
    <Shell title="Orders">
      <div className="card"><OrdersTable rows={view.rows} /></div>
      <div className="row"><button className="btn" onClick={() => go(view.page - 1)} disabled={view.page <= 1}>Prev</button><span>Page {view.page}</span><button className="btn" onClick={() => go(view.page + 1)}>Next</button></div>
    </Shell>
  );
}
