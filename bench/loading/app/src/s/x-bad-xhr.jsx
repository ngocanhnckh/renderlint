import { useEffect, useRef } from 'react';
import { Shell } from '../lib.jsx';
export default function Page() {
  const ref = useRef();
  useEffect(() => {
    const x = new XMLHttpRequest();
    x.open('GET', '/api/stats?x=xhr');
    x.onload = () => {
      const s = JSON.parse(x.responseText);
      ref.current.innerHTML = '<p>Revenue: <b>' + s.revenue + '</b></p><p>Orders: <b>' + s.orders + '</b></p><p>Users: <b>' + s.users + '</b></p>';
    };
    x.send();
  }, []);
  return <Shell title="Summary"><div className="card"><h3>This month</h3><div ref={ref} style={{ minHeight: 120 }} /></div></Shell>;
}
