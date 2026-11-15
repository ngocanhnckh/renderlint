// Shared helpers for the site build: paths, front matter, images, escaping.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import crypto from 'node:crypto';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const site = path.resolve(here, '..');
export const repo = path.resolve(site, '..');
export const dist = path.join(site, 'dist');

export const SITE = 'https://renderlint.yitec.net';
export const REPO = 'https://github.com/ngocanhnckh/renderlint';
export const NPM = 'https://www.npmjs.com/package/@yitec/renderlint';
export const PKG = '@yitec/renderlint';
export const INSTALL = 'npx -y @yitec/renderlint init';
export const AUTHOR = { name: 'ngocanhnckh', url: 'https://github.com/ngocanhnckh' };
export const VERSION = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugify = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[`'’"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function frontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: src.slice(m[0].length) };
}

// ---- images: resized WebP copies with width/height, cached per source ---------------------------
const cache = new Map();
export function resolveImage(ref) {
  if (ref.startsWith('captures/')) return path.join(site, 'content', ref);
  if (ref.startsWith('docs/')) return path.join(repo, 'docs', 'images', ref.slice(5));
  if (ref.startsWith('static/')) return path.join(site, ref);
  throw new Error(`Unknown image reference: ${ref} (use captures/…, docs/… or static/…)`);
}
export async function image(ref) {
  if (cache.has(ref)) return cache.get(ref);
  const file = resolveImage(ref);
  if (!fs.existsSync(file)) throw new Error(`Image not found: ${ref}`);
  const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
  const base = ref.replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + hash;
  const meta = await sharp(file).metadata();
  if (meta.format === 'gif') {
    // keep animations as they are
    const out = `/img/${base}.gif`;
    fs.mkdirSync(path.join(dist, 'img'), { recursive: true });
    fs.copyFileSync(file, path.join(dist, out));
    const r = { src: out, srcset: '', width: meta.width, height: meta.pageHeight || meta.height };
    cache.set(ref, r);
    return r;
  }
  const widths = [...new Set([640, 1280, meta.width].filter((w) => w <= meta.width))].sort((a, b) => a - b).slice(-3);
  const variants = [];
  for (const w of widths) {
    const out = `/img/${base}-${w}.webp`;
    const dest = path.join(dist, out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) await sharp(file).resize(w).webp({ quality: 82, effort: 5 }).toFile(dest);
    variants.push({ w, out });
  }
  const largest = variants[variants.length - 1];
  const r = {
    src: largest.out,
    srcset: variants.map((v) => `${v.out} ${v.w}w`).join(', '),
    width: largest.w,
    height: Math.round((meta.height * largest.w) / meta.width),
  };
  cache.set(ref, r);
  return r;
}
export async function img(ref, alt, { eager = false, sizes = '(max-width: 820px) 100vw, 720px', cls = '' } = {}) {
  const i = await image(ref);
  return `<img src="${i.src}"${i.srcset ? ` srcset="${i.srcset}" sizes="${sizes}"` : ''} width="${i.width}" height="${i.height}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'}${cls ? ` class="${cls}"` : ''}>`;
}

// Terminal output: colour the status lines the way the CLI does.
export function terminal(text) {
  return text.split('\n').map((l) => {
    const e = esc(l);
    if (/^\s*✖/.test(l)) return `<span class="e">${e}</span>`;
    if (/^\s*⚠/.test(l)) return `<span class="w">${e}</span>`;
    if (/^\s*✔/.test(l)) return `<span class="o">${e}</span>`;
    if (/^\s*(error|warn)\s/.test(l)) return e.replace(/^(\s*)(error|warn)/, (m, s, w) => `${s}<span class="${w === 'error' ? 'e' : 'w'}">${w}</span>`);
    if (/^\s+(at|with|in|page|fix)\s/.test(l)) return `<span class="d">${e}</span>`;
    return e;
  }).join('\n');
}

export function write(rel, content) {
  const dest = path.join(dist, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}
