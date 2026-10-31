// URL ↔ route pattern: matching a URL to the route that serves it, and grouping URLs into
// patterns when there is no source to read (a remote site, a sitemap): /products/123 and
// /products/456 are one route.

// Pattern → { re, keys, score }. Higher score = more specific (static segments first).
export function compile(pattern) {
  const keys = [];
  let re = '^', score = 0;
  for (const seg of pattern.split('/').filter(Boolean)) {
    const m = /^:([A-Za-z_$][\w$]*)([?+*]?)$/.exec(seg);
    if (m) {
      keys.push({ name: m[1], mod: m[2] });
      if (m[2] === '') { re += '/([^/]+)'; score += 3; }
      else if (m[2] === '?') { re += '(?:/([^/]+))?'; score += 2; }
      else if (m[2] === '+') { re += '/(.+)'; score += 1; }
      else { re += '(?:/(.*))?'; score += 0; }
    } else if (seg.includes(':')) {
      // mixed segment: post-:id
      let part = '';
      for (const piece of seg.split(/(:[A-Za-z_$][\w$]*)/)) {
        if (piece.startsWith(':')) { keys.push({ name: piece.slice(1), mod: '' }); part += '([^/]+?)'; } else part += esc(piece);
      }
      re += '/' + part; score += 3.5;
    } else { re += '/' + esc(seg); score += 4; }
  }
  return { re: new RegExp(re + '/?$'), keys, score };
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The route a path belongs to (most specific match), with its param values; null if none.
export function matchRoute(routes, path) {
  path = (path || '/').replace(/[?#].*$/, '');
  let decoded = path;
  try { decoded = decodeURI(path); } catch { /* keep raw */ }
  let best = null;
  for (const r of routes) {
    const c = r._c || (r._c = compile(r.pattern));
    const m = c.re.exec(path) || c.re.exec(decoded);
    if (!m) continue;
    if (best && best.c.score >= c.score) continue;
    const params = {};
    c.keys.forEach((k, i) => { if (m[i + 1] !== undefined) params[k.name] = m[i + 1]; });
    best = { route: r, params, c };
  }
  return best && { route: best.route, params: best.params };
}

// A segment that names one item of many: numbers, UUIDs, hashes, dates, long slugs with digits.
const ID_SEG = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|[0-9a-z]{20,}|\d{4}-\d{2}(-\d{2})?|[a-z]{1,3}\d+[a-z0-9]*)$/i;

// Groups paths into patterns without source routes. A segment becomes :param when it looks like an
// id, or when several sibling paths differ only there and share the same depth and prefix
// (/blog/my-first-post, /blog/hello-world → /blog/:slug once `minSiblings` share /blog/).
export function inferPatterns(paths, { minSiblings = 3 } = {}) {
  const split = paths.map((p) => p.replace(/[?#].*$/, '').split('/').filter(Boolean));
  // pass 1: id-like segments
  const shapes = split.map((segs) => segs.map((s) => (ID_SEG.test(s) ? ':id' : s)));
  // pass 2: sibling variation: same prefix and same depth, many distinct values at one position
  const groups = new Map();
  shapes.forEach((segs, i) => {
    for (let k = 0; k < segs.length; k++) {
      if (segs[k].startsWith(':')) continue;
      const key = segs.length + '|' + k + '|' + segs.slice(0, k).join('/') + '|' + segs.slice(k + 1).join('/');
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(i);
    }
  });
  for (const [key, set] of groups) {
    if (set.size < minSiblings) continue;
    const k = +key.split('|')[1];
    const values = new Set(Array.from(set, (i) => shapes[i][k]));
    if (values.size < minSiblings) continue;
    // only the last segment, or a segment followed by a fixed tail (/users/:id/edit)
    for (const i of set) shapes[i][k] = k === 0 ? shapes[i][k] : ':' + paramName(shapes[i][k - 1]);
  }
  const out = new Map();
  shapes.forEach((segs, i) => {
    let n = 0;
    const pattern = '/' + segs.map((s) => (s === ':id' && segs.filter((x) => x.startsWith(':')).length > 1 ? ':id' + (n++ || '') : s)).join('/');
    if (!out.has(pattern)) out.set(pattern, []);
    out.get(pattern).push(paths[i]);
  });
  return Array.from(out, ([pattern, urls]) => ({ pattern, urls, inferred: true }));
}

function paramName(prev) {
  const p = (prev || 'item').replace(/[^a-z0-9]/gi, '');
  if (/^(blog|posts?|articles?|news|docs?)$/i.test(p)) return 'slug';
  return 'id';
}
