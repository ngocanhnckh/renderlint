import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  return <Shell title="Orders"><div className="card"><h3>Orders ({d ? d.items.length : '…'})</h3>{d ? <OrdersTable rows={d.items} /> : <SkeletonRows />}</div></Shell>;
}
