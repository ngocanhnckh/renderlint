// The auth fixture app's API as MSW handlers, the way an app keeps them in src/mocks/handlers.ts.
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('/api/login', () => HttpResponse.json({ token: 'tok' })),
  http.get('/api/me', ({ request }) => (request.headers.get('authorization') === 'Bearer test'
    ? HttpResponse.json({ name: 'Dana' })
    : HttpResponse.json({ error: 'signed out' }, { status: 401 }))),
  http.get('/api/reports', () => HttpResponse.json([{ title: 'Q3 revenue' }, { title: 'Churn by plan' }])),
];
