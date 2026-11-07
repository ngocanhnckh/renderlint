import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [open, setOpen] = useState(false);
  return <Shell title="Team"><div className="card"><p>Ada Byrne · Owner</p><p>Kenji Mori · Editor</p><p>Lena Fox · Viewer</p></div><div className="card" style={{ position: 'relative' }}><button className="btn" onClick={() => setOpen(!open)}>What are roles?</button>{open && <div className="pop" role="dialog" aria-label="Roles" style={{ top: 50, left: 16 }}>Owners can do everything.</div>}</div></Shell>;
}
