import { useEffect, useState, Suspense, use } from 'react';
import { api, post, useFetch, Shell, OrdersTable, Stats, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [st, setSt] = useState('idle');
  const save = (e) => { e.preventDefault(); setSt('saving'); post('settings', {}).then(() => setSt('saved')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input defaultValue="Acme" /></label><button className="btn primary" disabled={st === 'saving'}>{st === 'saving' ? 'Saving...' : 'Save changes'}</button>{st === 'saved' && <div className="toast">Settings saved</div>}</form></Shell>;
}
