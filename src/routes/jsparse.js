// A small, forgiving reader for the parts of JS/TS source that route configs are made of:
// literals, arrays, objects, identifiers, calls, arrow functions, import() and JSX elements.
// It never runs the code. Anything it does not understand becomes { t: 'unknown' } and is skipped,
// so a route config written in an unusual way yields fewer routes, never an exception.

// Replaces comments with spaces (offsets stay the same) and skips strings and templates.
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; out += ' '.repeat(e - i); i = e; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; out += src.slice(i, e).replace(/[^\n]/g, ' '); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') { const e = skipString(src, i); out += src.slice(i, e); i = e; continue; }
    out += c; i++;
  }
  return out;
}

// End index (exclusive) of the string or template literal starting at i.
export function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (q === '`' && c === '$' && src[j + 1] === '{') { j = skipBalanced(src, j + 1) - 1; continue; }
    if (c === q) return j + 1;
    if (c === '\n' && q !== '`') return j + 1;
  }
  return src.length;
}

const OPEN = { '(': ')', '[': ']', '{': '}' };
// End index (exclusive) of the bracketed group starting at i.
export function skipBalanced(src, i) {
  const stack = [];
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j) - 1; continue; }
    if (OPEN[c]) stack.push(OPEN[c]);
    else if (c === ')' || c === ']' || c === '}') {
      stack.pop();
      if (!stack.length) return j + 1;
    }
  }
  return src.length;
}

function readString(src, i) {
  const end = skipString(src, i);
  const raw = src.slice(i + 1, end - 1);
  if (src[i] === '`' && raw.includes('${')) return { node: { t: 'unknown', raw: src.slice(i, end), template: raw }, end };
  return { node: { t: 'str', v: raw.replace(/\\(.)/g, '$1') }, end };
}

const ws = (src, i) => { while (i < src.length && /\s/.test(src[i])) i++; return i; };
const ID = /[A-Za-z_$][\w$]*/y;
function readId(src, i) { ID.lastIndex = i; const m = ID.exec(src); return m ? m[0] : null; }

// Skips to the next , ) ] } ; at depth 0 (the rest of an expression we don't model).
function skipRest(src, i) {
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(src, j) - 1; continue; }
    if (OPEN[c]) { j = skipBalanced(src, j) - 1; continue; }
    if (c === ',' || c === ')' || c === ']' || c === '}' || c === ';') return j;
    if (c === '<' && /[A-Za-z>]/.test(src[j + 1] || '') && /[(,=:?&|]\s*$/.test(src.slice(Math.max(0, j - 20), j))) { j = readJsx(src, j).end - 1; continue; }
  }
  return src.length;
}

// All import('…') specifiers in a stretch of source.
export function importsIn(text) {
  const out = [];
  const re = /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  for (let m; (m = re.exec(text));) out.push(m[2]);
  return out;
}

// Parses one expression starting at i. Returns { node, end }.
export function parseExpr(src, i) {
  i = ws(src, i);
  let { node, end } = parsePrimary(src, i);
  // postfix: member access, calls, TS casts and non-null assertions
  for (;;) {
    let j = ws(src, end);
    const c = src[j];
    if (c === '.' && src[j + 1] !== '.') {
      const name = readId(src, ws(src, j + 1));
      if (!name) break;
      end = ws(src, j + 1) + name.length;
      node = node.t === 'id' ? { t: 'id', name: node.name + '.' + name } : { t: 'member', obj: node, prop: name };
      continue;
    }
    if (c === '?' && src[j + 1] === '.') { end = j + 1; continue; }
    if (c === '!' && src[j + 1] !== '=') { end = j + 1; continue; }
    if (c === '(') {
      const args = [];
      let k = j + 1;
      for (;;) {
        k = ws(src, k);
        if (src[k] === ')') { k++; break; }
        if (k >= src.length) break;
        const a = parseExpr(src, k);
        args.push(a.node);
        k = ws(src, a.end);
        if (src[k] === ',') k++;
        else if (src[k] === ')') { k++; break; } else { k = skipBalanced(src, j); break; }
      }
      node = { t: 'call', callee: node, args };
      end = k;
      continue;
    }
    if (c === '[' ) { end = skipBalanced(src, j); node = { t: 'unknown', first: node }; continue; }
    if (/^(as|satisfies)\b/.test(src.slice(j, j + 10)) && /\s/.test(src[j - 1] || '')) {
      // TS: skip the type up to the end of the expression
      end = skipRest(src, j);
      continue;
    }
    break;
  }
  const j = ws(src, end);
  // automatic semicolon insertion: a new line starting with a word or a decorator ends the expression
  if (/\n/.test(src.slice(end, j)) && /[A-Za-z_$@#]/.test(src[j] || '')) return { node, end };
  if (j < src.length && !/[,)\]};]/.test(src[j]) && !(src[j] === ':' && node.t !== 'unknown')) {
    // a binary or ternary expression: keep the first operand for what it is worth
    const e = skipRest(src, j);
    return { node: { t: 'unknown', first: node }, end: e };
  }
  return { node, end };
}

function parsePrimary(src, i) {
  const c = src[i];
  if (c === '"' || c === "'" || c === '`') return readString(src, i);
  if (c === '[') {
    const items = [];
    let k = i + 1;
    for (;;) {
      k = ws(src, k);
      if (src[k] === ']') { k++; break; }
      if (k >= src.length) break;
      if (src[k] === ',') { k++; continue; }
      const spread = src.startsWith('...', k);
      const a = parseExpr(src, spread ? k + 3 : k);
      items.push(spread ? { t: 'spread', arg: a.node } : a.node);
      k = ws(src, a.end);
      if (src[k] === ',') k++;
      else if (src[k] === ']') { k++; break; } else { k = skipBalanced(src, i); break; }
    }
    return { node: { t: 'arr', items }, end: k };
  }
  if (c === '{') return parseObject(src, i);
  if (c === '(') {
    const close = skipBalanced(src, i);
    let k = ws(src, close);
    if (src[k] === ':') k = skipTypeAnnotation(src, k + 1);
    if (src.startsWith('=>', k)) return parseArrowBody(src, ws(src, k + 2));
    // parenthesized expression
    const inner = parseExpr(src, i + 1);
    return { node: inner.node, end: close };
  }
  if (c === '<' && /[A-Za-z>]/.test(src[i + 1] || '')) return readJsx(src, i);
  if (/[0-9]/.test(c || '') || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) {
    const m = /^-?[0-9][0-9_.eExXa-fA-F]*/.exec(src.slice(i, i + 40));
    return { node: { t: 'num', v: Number(m[0].replace(/_/g, '')) }, end: i + m[0].length };
  }
  if (src.startsWith('...', i)) { const a = parseExpr(src, i + 3); return { node: { t: 'spread', arg: a.node }, end: a.end }; }
  const id = readId(src, i);
  if (id) {
    let k = i + id.length;
    if (id === 'true' || id === 'false') return { node: { t: 'bool', v: id === 'true' }, end: k };
    if (id === 'null' || id === 'undefined') return { node: { t: 'null' }, end: k };
    if (id === 'async') { const n = ws(src, k); if (src[n] === '(' || readId(src, n)) return parsePrimary(src, n); }
    if (id === 'new') return parseExpr(src, k);
    if (id === 'await') return parseExpr(src, k);
    if (id === 'import' && src[ws(src, k)] === '(') {
      const close = skipBalanced(src, ws(src, k));
      const spec = importsIn(src.slice(i, close))[0];
      return { node: spec ? { t: 'import', spec } : { t: 'unknown' }, end: close };
    }
    if (id === 'function') {
      let k2 = ws(src, k);
      if (src[k2] === '*') k2 = ws(src, k2 + 1);
      const name = readId(src, k2);
      if (name) k2 += name.length;
      k2 = ws(src, k2);
      const close = skipBalanced(src, k2);
      const b = src.indexOf('{', close);
      const bend = skipBalanced(src, b);
      const body = src.slice(b, bend);
      return { node: { t: 'fn', body: returnedExpr(body), imports: importsIn(body), raw: body }, end: bend };
    }
    const n = ws(src, k);
    if (src.startsWith('=>', n)) return parseArrowBody(src, ws(src, n + 2));
    return { node: { t: 'id', name: id }, end: k };
  }
  return { node: { t: 'unknown' }, end: skipRest(src, i) };
}

function skipTypeAnnotation(src, k) {
  // return type of an arrow function: up to =>
  const j = src.indexOf('=>', k);
  return j < 0 ? k : j;
}

function parseArrowBody(src, k) {
  if (src[k] === '{') {
    const end = skipBalanced(src, k);
    const body = src.slice(k, end);
    return { node: { t: 'fn', body: returnedExpr(body), imports: importsIn(body), raw: body }, end };
  }
  const b = parseExpr(src, k);
  return { node: { t: 'fn', body: b.node, imports: importsIn(src.slice(k, b.end)), raw: src.slice(k, b.end) }, end: b.end };
}

// The expression of the last top-level `return` in a function body.
function returnedExpr(body) {
  const re = /\breturn\b/g;
  let last = null;
  for (let m; (m = re.exec(body));) last = m.index;
  if (last === null) return null;
  try { return parseExpr(body, last + 6).node; } catch { return null; }
}

function parseObject(src, i) {
  const props = {};
  const spreads = [];
  let k = i + 1;
  for (;;) {
    k = ws(src, k);
    if (src[k] === '}') { k++; break; }
    if (k >= src.length) break;
    if (src[k] === ',') { k++; continue; }
    if (src.startsWith('...', k)) {
      const a = parseExpr(src, k + 3);
      spreads.push(a.node);
      k = a.end;
      continue;
    }
    let key = null;
    if (src[k] === '"' || src[k] === "'") { const s = readString(src, k); key = s.node.v; k = s.end; }
    else if (src[k] === '[') { k = skipBalanced(src, k); }
    else {
      let id = readId(src, k);
      if (id === 'async' || id === 'get' || id === 'set') { const n = ws(src, k + id.length); const id2 = readId(src, n); if (id2) { k = n; id = id2; } }
      if (!id) { const m = /^[0-9]+/.exec(src.slice(k)); id = m ? m[0] : null; }
      if (!id) { k = skipRest(src, k); if (src[k] === '}') { k++; break; } k++; continue; }
      key = id; k += id.length;
    }
    k = ws(src, k);
    if (src[k] === '?') k = ws(src, k + 1);
    if (src[k] === ':') {
      const v = parseExpr(src, k + 1);
      if (key !== null) props[key] = v.node;
      k = v.end;
    } else if (src[k] === '(') {
      // method: name() { … }
      const close = skipBalanced(src, k);
      const b = src.indexOf('{', close);
      const end = skipBalanced(src, b);
      const body = src.slice(b, end);
      if (key !== null) props[key] = { t: 'fn', body: returnedExpr(body), imports: importsIn(body), raw: body };
      k = end;
    } else if (key !== null) {
      props[key] = { t: 'id', name: key }; // shorthand
    }
    k = ws(src, k);
    if (src[k] === ',') k++;
    else if (src[k] === '}') { k++; break; } else if (k < src.length) { k = skipRest(src, k); if (src[k] === ',') k++; }
  }
  return { node: { t: 'obj', props, spreads }, end: k };
}

// JSX element at i: { t: 'jsx', name, attrs, children }.
export function readJsx(src, i) {
  let k = i + 1;
  const name = (/^[A-Za-z_$][\w$.:-]*/.exec(src.slice(k)) || [''])[0];
  k += name.length;
  const attrs = {};
  for (;;) {
    k = ws(src, k);
    if (k >= src.length) return { node: { t: 'jsx', name, attrs, children: [] }, end: k };
    if (src.startsWith('/>', k)) return { node: { t: 'jsx', name, attrs, children: [] }, end: k + 2 };
    if (src[k] === '>') { k++; break; }
    if (src[k] === '{') { k = skipBalanced(src, k); continue; } // {...spread}
    const an = (/^[A-Za-z_$][\w$.:-]*/.exec(src.slice(k)) || [''])[0];
    if (!an) { k++; continue; }
    k = ws(src, k + an.length);
    if (src[k] !== '=') { attrs[an] = { t: 'bool', v: true }; continue; }
    k = ws(src, k + 1);
    if (src[k] === '"' || src[k] === "'") { const s = readString(src, k); attrs[an] = s.node; k = s.end; }
    else if (src[k] === '{') { const end = skipBalanced(src, k); attrs[an] = parseExpr(src, k + 1).node; k = end; }
    else k++;
  }
  const children = [];
  if (!name) { /* fragment */ }
  for (; k < src.length;) {
    if (src.startsWith('</', k)) { const e = src.indexOf('>', k); return { node: { t: 'jsx', name, attrs, children }, end: e < 0 ? src.length : e + 1 }; }
    if (src[k] === '<' && /[A-Za-z>]/.test(src[k + 1] || '')) { const c = readJsx(src, k); children.push(c.node); k = c.end; continue; }
    if (src[k] === '{') {
      const end = skipBalanced(src, k);
      // {cond && <Route …/>}, {list.map(() => <Route …/>)}: elements inside expressions count as children
      const inner = src.slice(k + 1, end - 1);
      for (const el of jsxElementsIn(inner)) children.push(el);
      k = end;
      continue;
    }
    k++;
  }
  return { node: { t: 'jsx', name, attrs, children }, end: k };
}

// Top-level JSX elements found anywhere in a piece of source.
export function jsxElementsIn(text, names) {
  const out = [];
  const re = names ? new RegExp('<(' + names.join('|') + ')\\b', 'g') : /<([A-Z][\w$.]*)\b/g;
  for (let m; (m = re.exec(text));) {
    const el = readJsx(text, m.index);
    out.push(el.node);
    re.lastIndex = Math.max(el.end, m.index + 1);
  }
  return out;
}

// import X from './x', import { A as B } from './y', import * as N from './z'  →  local name -> { from, name }
export function importMap(src) {
  const out = {};
  const re = /\bimport\s+(type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (let m; (m = re.exec(src));) {
    const clause = m[2], from = m[3];
    const def = /^([A-Za-z_$][\w$]*)/.exec(clause);
    if (def && def[1] !== 'type') out[def[1]] = { from, name: 'default' };
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (ns) out[ns[1]] = { from, name: '*' };
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) for (const part of named[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, '');
      if (!p) continue;
      const [a, b] = p.split(/\s+as\s+/);
      out[(b || a).trim()] = { from, name: a.trim() };
    }
  }
  return out;
}

// const NAME = <expr>, export const NAME: Type = <expr>, export default <expr>  →  name -> start of expr
export function declarations(src) {
  const out = {};
  const re = /(?:^|[;\n}])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;\n]+?)?\s*=(?!=|>)/g;
  for (let m; (m = re.exec(src));) out[m[1]] = m.index + m[0].length;
  const d = /(?:^|[;\n])\s*export\s+default\s+/.exec(src);
  if (d) out.default = d.index + d[0].length;
  return out;
}

// Literal value of a node (strings, numbers, arrays and objects of them), or undefined.
export function literal(node) {
  if (!node) return undefined;
  if (node.t === 'str' || node.t === 'num' || node.t === 'bool') return node.v;
  if (node.t === 'null') return null;
  if (node.t === 'arr') { const a = node.items.map(literal); return a.some((x) => x === undefined) ? undefined : a; }
  if (node.t === 'obj') {
    const o = {};
    for (const [k, v] of Object.entries(node.props)) { const x = literal(v); if (x === undefined) return undefined; o[k] = x; }
    return o;
  }
  return undefined;
}
