// Static file server (with SPA fallback) and dev-server process management.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain', '.map': 'application/json',
  '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.xml': 'application/xml', '.pdf': 'application/pdf',
};

export function serveStatic(dir, { port = 0, spa = true } = {}) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    const candidates = [file, join(file, 'index.html'), file + '.html'];
    let found = candidates.find((f) => existsSync(f) && statSync(f).isFile());
    if (!found && spa && !extname(path)) {
      const idx = join(root, 'index.html');
      if (existsSync(idx)) found = idx;
    }
    if (!found) {
      const nf = join(root, '404.html');
      res.writeHead(404, { 'content-type': 'text/html' });
      return existsSync(nf) ? createReadStream(nf).pipe(res) : res.end('Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(found).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(found).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      ok({ url: `http://127.0.0.1:${p}`, close: () => new Promise((c) => server.close(() => c())) });
    });
  });
}

export async function waitForUrl(url, { timeout = 120000, proc } = {}) {
  const start = Date.now();
  let exited = null;
  proc && proc.once('exit', (code) => { exited = code; });
  while (Date.now() - start < timeout) {
    if (exited !== null) throw new Error(`Server command exited with code ${exited} before ${url} became reachable.`);
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out after ${timeout / 1000}s waiting for ${url}`);
}

export function startCommand(cmd, { cwd = process.cwd(), env = {}, log = () => {} } = {}) {
  const proc = spawn(cmd, { cwd, shell: true, detached: process.platform !== 'win32', env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = (d) => { output += d; if (output.length > 20000) output = output.slice(-20000); };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);
  log(`Started: ${cmd}`);
  return {
    proc,
    output: () => output,
    // detect "Local: http://localhost:5173" style URLs printed by dev servers
    detectUrl() {
      const m = output.replace(/\x1b\[[0-9;]*m/g, '').match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s'"]*/);
      return m ? m[0].replace('0.0.0.0', '127.0.0.1').replace(/[.,)]+$/, '') : null;
    },
    stop() {
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
        else process.kill(-proc.pid, 'SIGTERM');
      } catch { /* already gone */ }
    },
  };
}

export async function startAndWait(cmd, { url, cwd, timeout = 120000, log } = {}) {
  const handle = startCommand(cmd, { cwd, log });
  const start = Date.now();
  let target = url;
  while (!target) {
    if (Date.now() - start > timeout) { handle.stop(); throw new Error('Could not detect the server URL from the command output. Pass --url.'); }
    target = handle.detectUrl();
    if (handle.proc.exitCode !== null) throw new Error(`Server command exited (${handle.proc.exitCode}):\n${handle.output().slice(-2000)}`);
    if (!target) await new Promise((r) => setTimeout(r, 300));
  }
  try {
    await waitForUrl(target, { timeout: timeout - (Date.now() - start), proc: handle.proc });
  } catch (e) {
    handle.stop();
    throw new Error(e.message + '\n--- server output ---\n' + handle.output().slice(-2000));
  }
  return { url: target, stop: handle.stop, output: handle.output };
}
