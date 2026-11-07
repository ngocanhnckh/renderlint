import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [st, setSt] = useState('idle');
  const save = (e) => { e.preventDefault(); setSt('saving'); fetch('/api/settings', { method: 'POST' }).then((r) => setSt(r.ok ? 'saved' : 'failed'), () => setSt('failed')); };
  return <Shell title="Settings"><form className="card" onSubmit={save}><label className="field">Store name<input name="store" required /></label><label className="field">Email<input name="email" type="email" required /></label><button className="btn primary" disabled={st === 'saving'}>{st === 'saving' ? 'Saving...' : 'Save changes'}</button></form>{st === 'saved' && <div className="toast">Settings saved</div>}{st === 'failed' && <div className="toast" role="alert">Couldn't save your settings. Try again.</div>}</Shell>;
}
