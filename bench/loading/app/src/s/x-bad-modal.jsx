import { useState } from 'react';
import { Shell } from '../lib.jsx';
export default function Page() {
  const [detail, setDetail] = useState(null);
  const view = async () => { const r = await fetch('/api/me?x=modal'); setDetail(await r.json()); };
  return (
    <Shell title="Profile">
      <div className="card"><p>Ada Byrne</p><button className="btn" onClick={view}>View account details</button></div>
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center' }} onClick={() => setDetail(null)}>
          <div className="card" role="dialog" style={{ width: 360 }}><h3>Account</h3><p>{detail.name} - {detail.plan}</p></div>
        </div>
      )}
    </Shell>
  );
}
