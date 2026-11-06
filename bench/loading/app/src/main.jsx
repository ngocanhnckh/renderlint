import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Link, Outlet, useLoaderData, useNavigation, useParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, useFetch, Shell, OrdersTable, SkeletonRows } from './lib.jsx';

const mods = import.meta.glob('./s/*.jsx', { eager: true });
const byId = Object.fromEntries(Object.entries(mods).map(([k, m]) => [k.slice(4, -4), m.default]));
function Scenario() { const { id } = useParams(); const C = byId[id]; return C ? <C /> : <p>unknown scenario {id}</p>; }

// route transitions
function Nav({ base }) {
  return <nav className="links"><Link to={base}>Home</Link><Link to={base + '/orders'}>Orders</Link><Link to={base + '/customers'}>Customers</Link></nav>;
}
const Home = () => <div className="card"><h3>Welcome back</h3><p>Pick a section above.</p></div>;
function LoadedTable() { const d = useLoaderData(); return <div className="card"><OrdersTable rows={d.items} /></div>; }
function LoaderLayout({ base, pending }) {
  const nav = useNavigation();
  const busy = pending && nav.state === 'loading';
  return <>{busy && <div className="topbar" />}<Shell title="Workspace"><Nav base={base} /><div className={busy ? 'dim' : ''}><Outlet /></div></Shell></>;
}
function EffectPage({ path, skeleton }) {
  const { data } = useFetch(path);
  if (!data) return skeleton ? <div className="card"><SkeletonRows /></div> : null;
  return <div className="card"><OrdersTable rows={data.items} /></div>;
}
const EffectLayout = ({ base }) => <Shell title="Workspace"><Nav base={base} /><Outlet /></Shell>;
const loader = (p) => () => api(p);
const loaderRoutes = (base, pending) => ({
  path: base, element: <LoaderLayout base={base} pending={pending} />,
  children: [{ index: true, element: <Home /> }, { path: 'orders', loader: loader('orders'), element: <LoadedTable /> }, { path: 'customers', loader: loader('customers'), element: <LoadedTable /> }],
});
const effectRoutes = (base, skeleton) => ({
  path: base, element: <EffectLayout base={base} />,
  children: [{ index: true, element: <Home /> }, { path: 'orders', element: <EffectPage path="orders" skeleton={skeleton} /> }, { path: 'customers', element: <EffectPage path="customers" skeleton={skeleton} /> }],
});

const router = createBrowserRouter([
  loaderRoutes('/s/route-bad-loader', false),
  loaderRoutes('/s/route-good-loader', true),
  effectRoutes('/s/route-bad-blank', false),
  effectRoutes('/s/route-good-skeleton', true),
  { path: '/s/:id', element: <Scenario /> },
  { path: '/', element: <Shell title="Bench"><div className="card">{Object.keys(byId).map((k) => <div key={k}><Link to={'/s/' + k}>{k}</Link></div>)}</div></Shell> },
]);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
