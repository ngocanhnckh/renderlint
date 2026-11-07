import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const nav = useNavigate();
  const tab = new URLSearchParams(location.search).get('tab') || 'overview';
  return <Shell title="Project">{['overview', 'activity', 'settings'].map((t) => <Link key={t} className="btn" replace to={'?tab=' + t}>{t[0].toUpperCase() + t.slice(1)}</Link>)}<div className="card"><p>{tab === 'overview' ? 'Project Atlas, 12 tasks open.' : tab === 'activity' ? 'Ada closed 3 tasks today.' : 'Visibility: team only.'}</p></div></Shell>;
}
