// Data stress: rewrite an API's JSON so human-readable strings get longer while
// everything the app's logic depends on (ids, enums, URLs, dates, numbers)
// stays exactly as it was.
const SKIP_KEY = /(^|_|-)(id|ids|uuid|guid|key|slug|url|uri|href|src|path|image|img|avatar|photo|icon|logo|token|hash|status|state|type|kind|role|code|currency|locale|lang|language|country|tz|timezone|color|colour|variant|mode|format|mime|method|version|sku|ref|cursor|etag)$|[a-z](Id|Ids|Url|Uri|At|Date|Time|Key|Type|Status|Code)$|^(created|updated|deleted|expires)/i;
const TEXT_KEY = /name|title|label|description|summary|subject|company|organi[sz]ation|email|address|street|city|comment|message|text|caption|bio|note|content|body|headline|excerpt|tagline|author|display|heading|question|answer|reason|detail/i;
const FILLER = 'internationalprocurementdepartment';

export function lengthenString(s, key, factor = 2) {
  if (typeof s !== 'string' || !s.trim() || s.length > 4000) return s;
  if (SKIP_KEY.test(key || '')) return s;
  if (/^(https?:|\/|\.\/|data:|blob:|#|mailto:|tel:)/i.test(s)) return s;            // links, paths, anchors
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^[\d\s.,:%+\-−$€£¥₫()/]+$/.test(s)) return s;   // dates, numbers, prices
  if (/^#?[0-9a-f]{3,8}$/i.test(s) || /^[0-9a-f-]{16,}$/i.test(s)) return s;           // colors, hashes, uuids
  if (/^[A-Z0-9_]+$/.test(s)) return s;                                                 // CONSTANTS
  const email = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(s);
  if (email) return email[1] + '.' + FILLER.slice(0, Math.max(8, 30 - s.length)) + '@' + email[2];
  const text = TEXT_KEY.test(key || '');
  if (!/\s/.test(s)) {
    // A single word is an identifier or enum unless it sits in a text field (a short name, a city).
    if (!text || !/\p{L}{2}/u.test(s)) return s;
    return s.length >= 24 ? s : s + FILLER.slice(0, 24 - s.length);
  }
  if (!/\p{L}{2}/u.test(s)) return s;
  const words = s.split(/\s+/);
  const extra = Math.max(1, Math.round(words.length * (factor - 1)));
  const add = [];
  for (let i = 0; i < extra; i++) add.push(words[i % words.length]);
  return s + ' ' + add.join(' ');
}

export function stressJson(value, factor = 2, key = '', depth = 0) {
  if (depth > 40) return value;
  if (typeof value === 'string') return lengthenString(value, key, factor);
  if (Array.isArray(value)) return value.map((v) => stressJson(v, factor, key, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stressJson(v, factor, k, depth + 1);
    return out;
  }
  return value;
}
