import { useState } from 'react';
import { Shell } from '../lib.jsx';
export default function Page() {
  const [m, setM] = useState({ open: false, data: null });
  const view = async () => { setM({ open: true, data: null }); const r = await fetch('/api/me?x=ml'); setM({ open: true, data: await r.json() }); };
  return (
    <Shell title="Profile">
      <div className="card"><button className="btn" onClick={view}>View account details</button></div>
      {m.open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center' }}>
          <div className="card" role="dialog" style={{ width: 360 }}>
            <h3>Account</h3>
            {m.data ? <p>{m.data.name} - {m.data.plan}</p> : <p style={{ color: '#6b7280' }}>Fetching your details...</p>}
            <button className="btn" onClick={() => setM({ open: false })}>Close</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
