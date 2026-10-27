#!/usr/bin/env node
import { main } from '../src/cli.js';

// Writes to a pipe are asynchronous: exiting right away would cut a large --json report off at 64KB.
const exit = (code) => process.stdout.write('', () => process.exit(code));

main(process.argv.slice(2)).then((code) => exit(code ?? 0), (err) => {
  console.error(err && err.stack || err);
  exit(2);
});
