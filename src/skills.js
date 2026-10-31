// Agent skills that `renderlint init` installs into a project (.claude/skills/<name>/SKILL.md).
// Plain Markdown with name/description frontmatter: Claude Code loads them as skills, and any other
// agent can read them (AGENTS.md points at them).
//
// Each installed copy ends with a marker line holding the template version and a hash of the content
// above it. That tells an untouched copy (safe to update) from one the user edited (left alone unless
// --force), so running init again is safe.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS = ['renderlint-setup', 'renderlint-fix', 'renderlint-e2e'];
export const SKILLS_DIR = join('.claude', 'skills');
const MARK = /\n?<!-- renderlint-skill: (\S+) (\S+) ([0-9a-f]{12}) -->\s*$/;

const version = () => JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
const hash = (s) => createHash('sha256').update(s.replace(/\r\n/g, '\n').trimEnd()).digest('hex').slice(0, 12);
export const skillTemplate = (name) => readFileSync(join(PKG_ROOT, 'skills', name, 'SKILL.md'), 'utf8');
export function skillDescription(name) {
  const m = /^description:\s*(.+)$/m.exec(skillTemplate(name));
  return m ? m[1].trim() : '';
}

function render(name) {
  const body = skillTemplate(name).trimEnd();
  return `${body}\n\n<!-- renderlint-skill: ${name} ${version()} ${hash(body)} -->\n`;
}

// What installing would do with one skill: 'install' | 'update' | 'current' | 'edited' | 'foreign'.
export function skillState(cwd, name) {
  const file = join(cwd, SKILLS_DIR, name, 'SKILL.md');
  if (!existsSync(file)) return 'install';
  const cur = readFileSync(file, 'utf8');
  const m = MARK.exec(cur);
  if (!m || m[1] !== name) return 'foreign'; // not written by renderlint init
  const body = cur.slice(0, m.index);
  if (hash(body) !== m[3]) return 'edited';
  return hash(body) === hash(skillTemplate(name)) ? 'current' : 'update';
}

// Installs the skills that are missing or outdated. Returns [{ name, file, state, written }].
export function installSkills(cwd, { force = false } = {}) {
  return SKILLS.map((name) => {
    const file = join(cwd, SKILLS_DIR, name, 'SKILL.md');
    const state = skillState(cwd, name);
    const write = state === 'install' || state === 'update' || (force && state !== 'current');
    if (write) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, render(name)); }
    return { name, file, state, written: write };
  });
}
