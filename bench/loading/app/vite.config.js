import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A fast local API, like a dev machine: every response in ~60ms, so missing loading states
// never show up while developing.
const orders = Array.from({ length: 8 }, (_, i) => ({
  id: 1040 + i, customer: ['Ada Byrne', 'Kenji Mori', 'Lena Fox', 'Omar Haddad', 'Priya Nair', 'Tom Ruiz', 'Wen Li', 'Zoe Hart'][i],
  total: '$' + (120 + i * 37) + '.00', status: ['Paid', 'Pending', 'Refunded', 'Paid'][i % 4],
}));
let page = 0;
const api = () => ({
  name: 'api',
  configureServer(server) {
    server.middlewares.use('/api', (req, res) => {
      const url = new URL(req.url, 'http://x');
      const delay = Number(url.searchParams.get('delay') || 60);
      const path = url.pathname.replace(/^\//, '');
      let body;
      if (req.method !== 'GET') body = { ok: true };
      else if (path.startsWith('me')) body = { name: 'Ada Byrne', plan: 'Pro' };
      else if (path.startsWith('stats')) body = { revenue: '$48,210', orders: '1,204', users: '312', churn: '2.1%' };
      else if (path.startsWith('notifications')) body = { count: 3 };
      else if (path.startsWith('ping') || path.startsWith('collect')) body = { ok: true };
      else if (path.startsWith('chart')) body = { bars: [40, 65, 52, 80, 71, 90, 62] };
      else if (path.startsWith('customers')) body = { items: orders.map((o) => ({ id: o.id, customer: o.customer, total: o.status, status: 'Active' })) };
      else if (path.startsWith('more')) body = { items: orders.map((o) => ({ ...o, id: o.id + 100 * ++page })) };
      else body = { items: orders, updatedAt: new Date().toISOString().slice(11, 19) };
      setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); }, delay);
    });
  },
});

export default defineConfig({
  plugins: [react(), api()],
  appType: 'spa',
  build: { rollupOptions: { input: { main: 'index.html', vanilla: 'vanilla.html' } } },
});
