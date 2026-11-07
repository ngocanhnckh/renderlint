import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [c, setC] = useState(false);
  return <Shell title="Share"><div className="card"><p>https://acme.test/r/42</p><button className="btn" onClick={() => { navigator.clipboard && navigator.clipboard.writeText('x').catch(() => {}); setC(true); }}>{c ? 'Copied!' : 'Copy link'}</button></div></Shell>;
}
