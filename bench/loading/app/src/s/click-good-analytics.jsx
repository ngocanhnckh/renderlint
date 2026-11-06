import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [open, setOpen] = useState(false);
  return <Shell title="Help"><div className="card"><button className="btn" onClick={() => { setOpen(true); post('collect', { e: 'help' }); }}>Contact support</button>{open && <p>Email us at help@acme.test</p>}</div></Shell>;
}
