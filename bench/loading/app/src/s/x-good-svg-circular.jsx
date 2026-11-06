import { useEffect, useState } from 'react';
import { Shell, OrdersTable } from '../lib.jsx';
const css = `@keyframes mr{100%{transform:rotate(360deg)}}@keyframes md{0%{stroke-dasharray:1px,200px;stroke-dashoffset:0}50%{stroke-dasharray:100px,200px;stroke-dashoffset:-15px}100%{stroke-dasharray:100px,200px;stroke-dashoffset:-125px}}
.mc{display:inline-block;animation:mr 1.4s linear infinite}.mc circle{stroke:#1976d2;stroke-dasharray:80px,200px;stroke-dashoffset:0;animation:md 1.4s ease-in-out infinite}`;
const CircularProgress = ({ size = 40 }) => <span className="mc" style={{ width: size, height: size }}><svg viewBox="22 22 44 44"><circle cx="44" cy="44" r="20.2" fill="none" strokeWidth="3.6" /></svg></span>;
export default function Page() {
  const [rows, setRows] = useState(null);
  useEffect(() => { fetch('/api/orders?x=svgc').then((r) => r.json()).then((d) => setRows(d.items)); }, []);
  return <Shell title="Orders"><style>{css}</style><div className="card" style={{ minHeight: 200 }}>{rows ? <OrdersTable rows={rows} /> : <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><CircularProgress /></div>}</div></Shell>;
}
