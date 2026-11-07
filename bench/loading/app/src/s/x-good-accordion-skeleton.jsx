import { useState } from 'react';
import { Shell } from '../lib.jsx';
export default function Page() {
  const [open, setOpen] = useState(null); const [data, setData] = useState({});
  const toggle = (k) => {
    setOpen(open === k ? null : k);
    if (open !== k && !data[k]) fetch('/api/customers?x=' + k).then((r) => r.json()).then((d) => setData((p) => ({ ...p, [k]: d.items })));
  };
  return (
    <Shell title="Teams">
      {['Sales', 'Support', 'Design'].map((k) => (
        <div className="card" key={k}>
          <button className="btn" onClick={() => toggle(k)} aria-expanded={open === k}>{k} team</button>
          {open === k && (data[k] ? <ul>{data[k].map((c) => <li key={c.id}>{c.customer}</li>)}</ul> : <div>{[80, 60, 70].map((w, i) => <div key={i} style={{ height: 14, width: w + '%', background: '#e5e7eb', margin: '10px 0', borderRadius: 4 }} />)}</div>)}
        </div>
      ))}
    </Shell>
  );
}
