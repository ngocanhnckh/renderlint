import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const [open, setOpen] = useState(false);
  const btn = useRef(null), field = useRef(null);
  const close = () => { setOpen(false); setTimeout(() => btn.current && btn.current.focus()); };
  useEffect(() => { if (open) field.current.focus(); }, [open]);
  return <Shell title="Team" actions={<button ref={btn} className="btn primary" onClick={() => setOpen(true)}>Invite member</button>}><div className="card"><p>Ada Byrne · Owner</p><p>Kenji Mori · Editor</p><p>Lena Fox · Viewer</p></div>{open && <div className="modal-back"><div className="modal" role="dialog" aria-modal="true" aria-label="Invite member"><h3>Invite member</h3><label className="field">Email<input ref={field} type="email" /></label><button className="btn" onClick={close}>Close</button></div></div>}</Shell>;
}
