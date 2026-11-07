import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [done, setDone] = useState(false);
  return <Shell title="Checkout"><div className="card"><p>Total $42.00</p><button className="btn primary" onClick={() => post('orders').then(() => setDone(true))}>Place order</button>{done && <p>Order placed</p>}</div></Shell>;
}
