import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
export default function Page() {
  const [rows, setRows] = useState(null); const [more, setMore] = useState(false);
  useEffect(() => { fetch('/api/orders?x=lm').then((r) => r.json()).then((d) => setRows(d.items)); }, []);
  const loadMore = async () => { setMore(true); const d = await (await fetch('/api/more')).json(); setRows((r) => [...r, ...d.items]); setMore(false); };
  if (!rows) return <Shell title="Orders"><p>Loading orders...</p></Shell>;
  return (
    <Shell title="Orders">
      <div className="card"><OrdersTable rows={rows} /></div>
      <button className="btn" disabled={more} onClick={loadMore}>{more ? 'Loading more...' : 'Show more'}</button>
    </Shell>
  );
}
