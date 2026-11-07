import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
const Block = ({ w }) => <div style={{ height: 18, width: w, background: '#e2e4e9', borderRadius: 4, margin: '14px 0' }} />;
export default function Page() {
  const [rows, setRows] = useState();
  useEffect(() => { fetch('/api/orders?x=inl').then((r) => r.json()).then((d) => setRows(d.items)); }, []);
  return (
    <Shell title="Orders">
      <div className="card">
        {rows === undefined ? <div><Block w="30%" /><Block w="95%" /><Block w="88%" /><Block w="92%" /><Block w="70%" /></div> : <OrdersTable rows={rows} />}
      </div>
    </Shell>
  );
}
