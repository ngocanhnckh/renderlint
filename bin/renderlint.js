#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then((code) => process.exit(code ?? 0), (err) => {
  console.error(err && err.stack || err);
  process.exit(2);
});
