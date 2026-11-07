import { useEffect, useState } from 'react';
import { Shell } from '../lib.jsx';
export default function Page() {
  const [s, setS] = useState(null);
  useEffect(() => { fetch('/api/stats?x=dash').then((r) => r.json()).then(setS); }, []);
  return (
    <Shell title="Overview">
      <div className="grid">{[['Revenue', 'revenue'], ['Orders', 'orders'], ['Users', 'users'], ['Churn', 'churn']].map(([l, k]) => <div className="card stat" key={k}><span>{l}</span><b>{s ? s[k] : '—'}</b></div>)}</div>
    </Shell>
  );
}
