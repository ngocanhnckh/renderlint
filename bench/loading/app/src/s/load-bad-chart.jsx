import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const { data } = useFetch('chart');
  return <Shell title="Revenue"><div className="card"><h3>Last 7 days</h3><div className="chart">{data && data.bars.map((h, i) => <i key={i} style={{ height: h + '%' }} />)}</div></div></Shell>;
}
