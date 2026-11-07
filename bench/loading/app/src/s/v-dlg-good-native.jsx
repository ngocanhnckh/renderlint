import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, post, Shell, OrdersTable, Spinner, SkeletonRows } from '../lib.jsx';
export default function P() {
  const ref = useRef(null);
  return <Shell title="Team" actions={<button className="btn primary" onClick={() => ref.current.showModal()}>Invite member</button>}><div className="card"><p>Ada Byrne · Owner</p><p>Kenji Mori · Editor</p><p>Lena Fox · Viewer</p></div><dialog className="modal" ref={ref}><h3>Invite member</h3><label className="field">Email<input type="email" /></label><form method="dialog"><button className="btn">Cancel</button></form></dialog></Shell>;
}
