import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const q = useQuery({ queryKey: ['customers'], queryFn: () => api('customers') });
  return <Shell title="Customers"><div className="card">{q.isPending ? <SkeletonRows /> : q.data.items.length === 0 ? <p>Nothing here yet. Invite your first customer.</p> : <OrdersTable rows={q.data.items} />}</div></Shell>;
}
