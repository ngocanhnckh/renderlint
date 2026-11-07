import { useEffect, useState } from 'react';
import { Shell } from '../lib.jsx';
export default function Page() {
  const [, setFlags] = useState(null);
  useEffect(() => { fetch('/api/stats?x=unused').then((r) => r.json()).then(setFlags); }, []);
  return <Shell title="Help center"><div className="card"><h3>Getting started</h3><p>Welcome. Browse the guides in the sidebar or contact support at help@acme.test.</p></div></Shell>;
}
