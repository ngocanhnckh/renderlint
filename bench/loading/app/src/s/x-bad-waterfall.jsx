import { useEffect, useState } from 'react';
import { Shell, OrdersTable, Stats } from '../lib.jsx';
const get = (p) => fetch('/api/' + p).then((r) => r.json());
export default function Page() {
  const [me, setMe] = useState(null);
  const [rest, setRest] = useState(null);
  useEffect(() => { get('me?x=wf').then(setMe); }, []);
  useEffect(() => {
    if (!me) return;
    Promise.all([get('stats?x=wf'), get('orders?x=wf')]).then(([stats, orders]) => setRest({ stats, orders }));
  }, [me]);
  return (
    <Shell title="Dashboard">
      {me && <p>Hello, {me.name} ({me.plan})</p>}
      {rest && <><Stats s={rest.stats} /><div className="card"><OrdersTable rows={rest.orders.items} /></div></>}
    </Shell>
  );
}
