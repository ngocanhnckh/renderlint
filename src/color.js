// Color math shared by the Node side (mirrors the in-page helpers).
export function luminance({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export function blend(fg, bg) {
  const a = fg.a ?? 1;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
export function hex(c) {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}
function mix(c, towards, t) { return { r: c.r + (towards - c.r) * t, g: c.g + (towards - c.g) * t, b: c.b + (towards - c.b) * t }; }

// Smallest change that reaches the target ratio: adjust the text color first,
// otherwise the background. Returns a human-readable suggestion.
export function suggestColor(fg, bg, target) {
  let best = null;
  for (const towards of [0, 255]) {
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const c = mix(fg, towards, t);
      if (contrast(c, bg) >= target) { if (!best || t < best.t) best = { t, text: hex(c) }; break; }
    }
  }
  if (best) return `text ${best.text}`;
  for (const towards of [0, 255]) {
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const c = mix(bg, towards, t);
      if (contrast(fg, c) >= target) { if (!best || t < best.t) best = { t, text: hex(c) }; break; }
    }
  }
  return best ? `background ${best.text}` : undefined;
}
