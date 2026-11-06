import { useMutation } from '@tanstack/react-query';
import { Shell } from '../lib.jsx';
export default function Page() {
  const m = useMutation({ mutationFn: () => fetch('/api/archive?x=2', { method: 'POST' }).then((r) => r.json()) });
  return (
    <Shell title="Project settings">
      <div className="card">
        <p>Archive this project and hide it from the sidebar.</p>
        <button className="btn primary" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Archiving...' : 'Archive project'}</button>
        {m.isSuccess && <p>Project archived.</p>}
      </div>
    </Shell>
  );
}
