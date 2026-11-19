import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findingKey, writeBaseline, readBaseline, applyBaseline, trackProgress } from '../src/baseline.js';

const issue = (o) => ({ rule: 'text-overflow', severity: 'error', selector: 'main > div.card:nth-of-type(2) > p', text: 'Total $4,939.27', pages: ['/'], count: 1, ...o });

test('findingKey ignores list positions, generated class names and numbers', () => {
  const a = findingKey(issue({}));
  assert.equal(findingKey(issue({ selector: 'main > div.card:nth-of-type(5) > p', text: 'Total $12.00' })), a);
  assert.equal(findingKey(issue({ selector: 'main > div.Card_root__a1B2c > p' })), findingKey(issue({ selector: 'main > div.Card_root__x9Y8z > p' })));
  assert.equal(findingKey(issue({ selector: 'div.css-1q2w3e > p' })), findingKey(issue({ selector: 'div.css-9z8x7c > p' })));
  assert.notEqual(findingKey(issue({ rule: 'contrast' })), a);
  assert.notEqual(findingKey(issue({ text: 'Subtotal' })), a);
  assert.equal(findingKey({ rule: 'emoji', file: 'src\\App.tsx', line: 12, text: '🚀' }), 'emoji | src/App.tsx:12 | 🚀');
});

test('a baseline hides known findings and notices fixed ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-bl-'));
  const path = join(dir, 'renderlint-baseline.json');
  assert.equal(writeBaseline(path, [issue({}), issue({ rule: 'contrast', text: 'Fine print', pages: ['/about'] }), issue({ pages: ['/'] })]), 2);
  const bl = readBaseline(path);
  const now = [issue({ selector: 'main > div.card:nth-of-type(3) > p' }), issue({ rule: 'emoji', text: '🚀' })];
  const r = applyBaseline(now, bl, ['/', '/about']);
  assert.deepEqual([now[0].known, now[1].known], [true, undefined]);
  assert.deepEqual([r.known, r.fixed], [1, 1]); // the contrast finding on /about is gone
  // a finding on a page this run didn't check isn't counted as fixed
  const again = [issue({})];
  assert.equal(applyBaseline(again, bl, ['/']).fixed, 0);
  assert.equal(readBaseline(join(dir, 'missing.json')), null);
});

test('progress compares with the previous run, only on pages checked both times', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-prog-'));
  assert.equal(trackProgress(dir, [issue({}), issue({ rule: 'contrast', pages: ['/about'] })], ['/', '/about']), null); // first run
  // second run checks only /: the /about finding wasn't re-checked, so it isn't "fixed"
  const p = trackProgress(dir, [issue({ rule: 'emoji', text: '✨' })], ['/']);
  assert.deepEqual([p.fixed, p.new], [1, 1]);
  const saved = JSON.parse(readFileSync(join(dir, 'last-run.json'), 'utf8')).findings;
  assert.ok(Object.keys(saved).some((k) => k.startsWith('contrast')), 'kept: not checked this time');
  assert.ok(!Object.keys(saved).some((k) => k.startsWith('text-overflow')), 'dropped: fixed');
  writeFileSync(join(dir, 'last-run.json'), '{broken');
  assert.equal(trackProgress(dir, [], ['/']), null); // unreadable state: start over
});
