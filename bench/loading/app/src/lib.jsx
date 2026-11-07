import { useCallback, useEffect, useState } from 'react';

export const api = (path, opts) => fetch('/api/' + path, opts).then((r) => r.json());
export const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

export function useFetch(path) {
  const [state, set] = useState({ data: null, loading: true });
  const reload = useCallback(() => {
    set((s) => ({ ...s, loading: true }));
    return api(path).then((data) => set({ data, loading: false }));
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export function Shell({ title, actions, children }) {
  return (
    <div className="app">
      <aside className="side"><b>Acme</b><span>Dashboard</span><span>Orders</span><span>Customers</span><span>Settings</span></aside>
      <main className="main">
        <div className="top"><h1>{title}</h1><div>{actions}</div></div>
        {children}
      </main>
    </div>
  );
}

export function OrdersTable({ rows }) {
  return (
    <table className="tbl">
      <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>{rows.map((o) => <tr key={o.id}><td>#{o.id}</td><td>{o.customer}</td><td>{o.total}</td><td>{o.status}</td></tr>)}</tbody>
    </table>
  );
}

export function Stats({ s }) {
  return (
    <div className="grid">
      {[['Revenue', s.revenue], ['Orders', s.orders], ['Users', s.users], ['Churn', s.churn]].map(([k, v]) => (
        <div className="card stat" key={k}><span>{k}</span><b>{v}</b></div>
      ))}
    </div>
  );
}

// a spinner with hashed class names, like CSS modules output: no "spinner" in the DOM
export const Spinner = ({ small }) => <div className={'_k3x9' + (small ? ' sm' : '')} />;
export const SkeletonRows = ({ n = 6, cls = 'skeleton' }) => <div>{Array.from({ length: n }, (_, i) => <div key={i} className={cls} style={{ width: 60 + ((i * 17) % 40) + '%' }} />)}</div>;
