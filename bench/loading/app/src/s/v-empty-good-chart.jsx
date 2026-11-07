import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('chart').then(set); }, []);
  return <Shell title="Revenue"><div className="card"><h3>Last 7 days</h3>{d ? <div style={{ display: 'flex', gap: 8, alignItems: 'end', height: 160 }}>{d.bars.map((b, i) => <div key={i} style={{ width: 30, height: b * 1.5, background: '#2563eb' }} />)}</div> : <div style={{ height: 160 }}><SkeletonRows n={3} /></div>}</div></Shell>;
}
