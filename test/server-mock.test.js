// The server-side mock preload: off without renderlint's environment variable, and only answering
// requests that come to a loopback host (a server reachable from outside never serves test data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(here, '../src/server-mock.cjs');
// An app server whose pages fetch an API on the server; the API host doesn't exist.
const APP = `
const http = require('node:http');
const s = http.createServer(async (req, res) => {
  let body;
  try { body = await (await fetch('http://api.renderlint.invalid/api/me')).text(); } catch { body = 'real network'; }
  res.end(body);
});
s.listen(0, '127.0.0.1', () => console.log('PORT ' + s.address().port));
`;

async function startApp(env) {
  const dir = mkdtempSync(join(tmpdir(), 'rl-sm-'));
  const plan = join(dir, 'plan.json');
  writeFileSync(plan, JSON.stringify({ mock: { '**/api/me': { name: 'Mocked' } }, roles: {}, states: {}, self: [] }));
  const child = spawn(process.execPath, ['--require', PRELOAD, '-e', APP], { env: { ...process.env, RENDERLINT_SERVER_MOCK: '', ...env(plan) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { const m = /PORT (\d+)/.exec(String(d)); if (m) resolve(+m[1]); });
    child.on('exit', (c) => reject(new Error('app exited ' + c + ': ' + err)));
  });
  return { port, stop: () => child.kill(), stderr: () => err };
}

const get = (port, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b)); }).on('error', reject);
});

test('server mock: answers requests to a loopback host only', async () => {
  const app = await startApp((plan) => ({ RENDERLINT_SERVER_MOCK: plan }));
  try {
    assert.match(await get(app.port, `localhost:${app.port}`), /Mocked/);
    assert.match(await get(app.port, `127.0.0.1:${app.port}`), /Mocked/);
    // addressed to a public host name (a proxy, a deployed server): the real network
    assert.equal(await get(app.port, 'shop.example.com'), 'real network');
    assert.match(app.stderr(), /non-loopback host: not mocked/);
  } finally { app.stop(); }
});

test('server mock: does nothing without renderlint\'s environment variable', async () => {
  const app = await startApp(() => ({}));
  try {
    assert.equal(await get(app.port, `localhost:${app.port}`), 'real network');
  } finally { app.stop(); }
});
