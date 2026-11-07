import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() { return <Shell title="Home" actions={<Link className="btn" replace to="/s/v-back-target">Invoices</Link>}><div className="card"><p>Welcome back, Ada.</p><p>3 projects are active.</p><p>2 invoices are due this week.</p><p>Your plan renews on May 1.</p></div></Shell>; }
