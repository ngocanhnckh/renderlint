import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [st, setSt] = useState('idle');
  const save = (e) => { e.preventDefault(); setSt('saving'); fetch('/api/settings', { method: 'POST' }).then((r) => { if (!r.ok) throw new Error('save'); setSt('saved'); }).catch(() => setSt('idle')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input name="store" required /></label><button className="btn primary" disabled={st === 'saving'}>{st === 'saving' ? 'Saving...' : 'Save changes'}</button>{st === 'saved' && <div className="toast">Settings saved</div>}</form></Shell>;
}
