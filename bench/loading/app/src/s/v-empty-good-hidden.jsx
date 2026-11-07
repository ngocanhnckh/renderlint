import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  return <Shell title="Dashboard"><div className="card"><h3>Your store</h3><p>Acme Goods, on the Pro plan.</p><p>Payouts every Monday.</p></div>{d && d.items.length > 0 && <div className="card"><h3>Recent activity</h3><OrdersTable rows={d.items.slice(0, 4)} /></div>}<div className="card"><h3>Need help?</h3><p>Our team answers in under an hour.</p></div></Shell>;
}
