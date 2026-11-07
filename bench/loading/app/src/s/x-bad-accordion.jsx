import { useState } from 'react';
import { Shell } from '../lib.jsx';
export default function Page() {
  const [open, setOpen] = useState(null);
  const [data, setData] = useState({});
  const toggle = (k) => {
    if (open === k) return setOpen(null);
    if (data[k]) return setOpen(k);
    fetch('/api/customers?x=' + k).then((r) => r.json()).then((d) => { setData((p) => ({ ...p, [k]: d.items })); setOpen(k); });
  };
  return (
    <Shell title="Teams">
      {['Sales', 'Support', 'Design'].map((k) => (
        <div className="card" key={k}>
          <button className="btn" onClick={() => toggle(k)} aria-expanded={open === k}>{k} team</button>
          {open === k && <ul>{data[k].map((c) => <li key={c.id}>{c.customer}</li>)}</ul>}
        </div>
      ))}
    </Shell>
  );
}
