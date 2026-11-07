import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
const cache = new Map(); const subs = new Map();
function useSWR(key, fetcher) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    (subs.get(key) || subs.set(key, new Set()).get(key)).add(f);
    if (!cache.has(key)) fetcher(key).then((d) => { cache.set(key, d); subs.get(key).forEach((s) => s()); });
    return () => subs.get(key).delete(f);
  }, [key]);
  return { data: cache.get(key) };
}
export default function Page() {
  const { data } = useSWR('/api/orders?x=swr1', (u) => fetch(u).then((r) => r.json()));
  return <Shell title="Recent orders"><div className="card">{data && <OrdersTable rows={data.items} />}</div></Shell>;
}
