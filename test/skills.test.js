// Agent skills installed by `renderlint init`: missing or outdated ones are written, edited ones are left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { installSkills, skillState, skillTemplate, SKILLS } from '../src/skills.js';
import { init } from '../src/init.js';

const dir = () => mkdtempSync(join(tmpdir(), 'rl-skills-'));
const file = (cwd, name) => join(cwd, '.claude', 'skills', name, 'SKILL.md');
const states = (res) => Object.fromEntries(res.map((r) => [r.name, r.state]));

test('skill templates have the frontmatter Claude Code needs', () => {
  for (const name of SKILLS) {
    const t = skillTemplate(name);
    assert.match(t, new RegExp(`^---\\nname: ${name}\\ndescription: .{40,}\\n---\\n`), name);
    assert.match(t.split('\n')[2], /Use (when|after)/, `${name}: the description says when to use it`);
  }
});

test('installs missing skills, leaves current and edited ones alone, updates outdated ones, --force replaces', () => {
  const cwd = dir();
  assert.deepEqual(states(installSkills(cwd)), Object.fromEntries(SKILLS.map((n) => [n, 'install'])));
  for (const n of SKILLS) assert.ok(readFileSync(file(cwd, n), 'utf8').startsWith(skillTemplate(n).trimEnd()));

  // run again: nothing to do
  const again = installSkills(cwd);
  assert.ok(again.every((r) => r.state === 'current' && !r.written), JSON.stringify(again));

  // the user edits one: kept, also on later runs
  const edited = readFileSync(file(cwd, 'renderlint-fix'), 'utf8').replace('# Fix what renderlint reports', '# Fix what renderlint reports (our team notes: ask Sam about the charts)');
  writeFileSync(file(cwd, 'renderlint-fix'), edited);
  assert.equal(skillState(cwd, 'renderlint-fix'), 'edited');
  installSkills(cwd);
  assert.equal(readFileSync(file(cwd, 'renderlint-fix'), 'utf8'), edited);
  // notes appended below the marker count as an edit too
  installSkills(cwd, { force: true });
  const appended = readFileSync(file(cwd, 'renderlint-fix'), 'utf8') + 'Our note.\n';
  writeFileSync(file(cwd, 'renderlint-fix'), appended);
  assert.equal(skillState(cwd, 'renderlint-fix'), 'edited');
  installSkills(cwd);
  assert.equal(readFileSync(file(cwd, 'renderlint-fix'), 'utf8'), appended);
  writeFileSync(file(cwd, 'renderlint-fix'), edited);

  // an older version written by init (marker matches its content): updated
  const old = '---\nname: renderlint-setup\ndescription: old text. Use when old.\n---\n\nOld instructions.';
  const h = createHash('sha256').update(old).digest('hex').slice(0, 12);
  writeFileSync(file(cwd, 'renderlint-setup'), `${old}\n\n<!-- renderlint-skill: renderlint-setup 0.1.0 ${h} -->\n`);
  assert.equal(skillState(cwd, 'renderlint-setup'), 'update');
  const up = installSkills(cwd).find((r) => r.name === 'renderlint-setup');
  assert.ok(up.written && readFileSync(file(cwd, 'renderlint-setup'), 'utf8').includes('# Make renderlint check every page'));

  // a SKILL.md renderlint didn't write: kept
  writeFileSync(file(cwd, 'renderlint-e2e'), '---\nname: renderlint-e2e\ndescription: ours\n---\nTeam version.\n');
  assert.equal(skillState(cwd, 'renderlint-e2e'), 'foreign');
  installSkills(cwd);
  assert.match(readFileSync(file(cwd, 'renderlint-e2e'), 'utf8'), /Team version/);

  // --force replaces both
  const forced = installSkills(cwd, { force: true });
  assert.ok(forced.filter((r) => r.written).map((r) => r.name).sort().join() === 'renderlint-e2e,renderlint-fix', JSON.stringify(forced));
  assert.ok(SKILLS.every((n) => skillState(cwd, n) === 'current'));
});

test('init installs the skills and points AGENTS.md at them; --no-skills points at the package instead', async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const cwd = dir();
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'app', private: true, devDependencies: { '@yitec/renderlint': '^0.2.0' } }));
    writeFileSync(join(cwd, 'index.html'), '<!doctype html><title>t</title>');
    const prev = process.cwd();
    process.chdir(cwd);
    try { await init(['--no-install', '--no-browser', '--no-hook']); } finally { process.chdir(prev); }
    for (const n of SKILLS) assert.ok(existsSync(file(cwd, n)), n);
    const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    assert.match(agents, /`\.claude\/skills\/renderlint-setup\/SKILL\.md`/);

    const cwd2 = dir();
    mkdirSync(join(cwd2, 'src'));
    writeFileSync(join(cwd2, 'package.json'), JSON.stringify({ name: 'app2', private: true }));
    writeFileSync(join(cwd2, 'index.html'), '<!doctype html><title>t</title>');
    process.chdir(cwd2);
    try { await init(['--no-install', '--no-browser', '--no-hook', '--no-skills']); } finally { process.chdir(prev); }
    assert.ok(!existsSync(join(cwd2, '.claude', 'skills')));
    assert.match(readFileSync(join(cwd2, 'AGENTS.md'), 'utf8'), /node_modules\/@yitec\/renderlint\/skills\/renderlint-setup\/SKILL\.md/);
  } finally { console.log = quiet; }
});
