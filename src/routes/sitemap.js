// URLs a site lists itself: robots.txt "Sitemap:" lines, /sitemap.xml and sitemap indexes (one level
// of nesting, .xml.gz too). Same-origin URLs only; nothing here is fatal.
import { gunzipSync } from 'node:zlib';

async function get(url, timeout) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (/\.gz(\?|$)/.test(url) && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8');
    return buf.toString('utf8');
  } catch { return null; }
}

export async function sitemapUrls(base, { timeout = 5000, max = 20000, maxFiles = 30 } = {}) {
  const origin = new URL(base).origin;
  const out = new Set();
  const sources = [];
  const disallow = [];
  const robots = await get(origin + '/robots.txt', timeout);
  const maps = [];
  if (robots && !/<html/i.test(robots)) {
    let applies = false;
    for (const line of robots.split(/\r?\n/)) {
      const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const k = m[1].toLowerCase();
      if (k === 'sitemap') maps.push(m[2]);
      else if (k === 'user-agent') applies = m[2] === '*';
      else if (k === 'disallow' && applies && m[2]) disallow.push(m[2]);
    }
    sources.push('robots.txt');
  }
  if (!maps.length) maps.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml');
  const seen = new Set();
  const visit = async (url, depth) => {
    if (seen.has(url) || seen.size >= maxFiles || out.size >= max) return;
    seen.add(url);
    const xml = await get(url, timeout);
    if (!xml || !/<(urlset|sitemapindex)\b/.test(xml)) return;
    sources.push(new URL(url, origin).pathname);
    const locs = Array.from(xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/g), (m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex\b/.test(xml)) { if (depth < 2) for (const l of locs) await visit(sameOrigin(l, origin), depth + 1); return; }
    for (const l of locs) {
      try {
        const u = new URL(l, origin);
        // sitemaps often name the production host: keep the path, check it here
        out.add(u.pathname + u.search);
      } catch { /* bad URL */ }
      if (out.size >= max) break;
    }
  };
  for (const m of maps) await visit(sameOrigin(m, origin), 0);
  return { urls: Array.from(out), sources, disallow };
}

function sameOrigin(u, origin) { try { const x = new URL(u, origin); return origin + x.pathname + x.search; } catch { return u; } }
