import { useEffect, useState } from 'react';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [d, set] = useState(null);
  useEffect(() => { api('orders').then(set); }, []);
  return <Shell title="Orders">{d && <div className="card" style={{ height: 240, background: '#fef3c7' }}><h3>New: bulk export</h3></div>}<div className="card"><OrdersTable rows={[{ id: 1, customer: 'Ada Byrne', total: '$120.00', status: 'Paid' }, { id: 2, customer: 'Kenji Mori', total: '$157.00', status: 'Paid' }, { id: 3, customer: 'Lena Fox', total: '$194.00', status: 'Paid' }, { id: 4, customer: 'Omar Haddad', total: '$231.00', status: 'Paid' }]} /></div><div className="card"><p>Need help? Contact support.</p></div></Shell>;
}
