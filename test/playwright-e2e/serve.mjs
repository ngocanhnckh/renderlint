// Serves the auth fixture app (an SPA: unknown paths get index.html) on the given port.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const srv = await serveStatic(join(here, '../fixtures/auth'), { spa: true, port: +process.argv[2] });
console.log('serving at ' + srv.url);
