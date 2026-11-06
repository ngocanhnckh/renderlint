import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [msg, setMsg] = useState('');
  const save = (e) => { e.preventDefault(); post('settings', {}).then(() => setMsg('Settings saved')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input defaultValue="Acme" /></label><button className="btn primary">Save changes</button></form>{msg && <div className="toast">{msg}</div>}</Shell>;
}
