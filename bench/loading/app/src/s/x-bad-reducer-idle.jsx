import { useEffect, useReducer } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
function reducer(s, a) {
  switch (a.type) { case 'start': return { status: 'pending' }; case 'ok': return { status: 'ok', rows: a.rows }; case 'fail': return { status: 'error' }; default: return s; }
}
export default function Page() {
  const [s, dispatch] = useReducer(reducer, { status: 'idle' });
  useEffect(() => {
    dispatch({ type: 'start' });
    fetch('/api/orders?x=red').then((r) => r.json()).then((d) => dispatch({ type: 'ok', rows: d.items }), () => dispatch({ type: 'fail' }));
  }, []);
  return (
    <Shell title="Order history">
      <div className="card">
        {s.status === 'ok' && <OrdersTable rows={s.rows} />}
        {s.status === 'error' && <p role="alert">Could not load orders.</p>}
      </div>
    </Shell>
  );
}
