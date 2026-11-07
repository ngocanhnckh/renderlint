import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [view, setView] = useState('home');
  const go = (e) => { e.preventDefault(); history.pushState(null, '', '/s/v-back-bad-pushstate/invoices'); setView('invoices'); };
  return <Shell title={view === 'home' ? 'Home' : 'Invoices'} actions={<a className="btn" href="/s/v-back-bad-pushstate/invoices" onClick={go}>Invoices</a>}>{view === 'home' ? <div className="card"><p>Welcome back, Ada.</p><p>3 projects are active.</p><p>2 invoices are due this week.</p><p>Your plan renews on May 1.</p></div> : <div className="card"><p>Invoice INV-2041 · $49.00 · Paid</p><p>Invoice INV-2040 · $49.00 · Paid</p><p>Invoice INV-2039 · $49.00 · Paid</p><p>Billing email: ada@example.com</p></div>}</Shell>;
}
