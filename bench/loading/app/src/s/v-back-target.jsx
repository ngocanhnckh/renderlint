import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() { return <Shell title="Invoices"><div className="card"><p>Invoice INV-2041 · $49.00 · Paid</p><p>Invoice INV-2040 · $49.00 · Paid</p><p>Invoice INV-2039 · $49.00 · Paid</p><p>Billing email: ada@example.com</p></div></Shell>; }
