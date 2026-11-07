import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  return <Shell title="Reports" actions={<button className="btn" onClick={() => {}}>Export CSV</button>}><div className="card"><p>Monthly revenue report.</p></div></Shell>;
}
