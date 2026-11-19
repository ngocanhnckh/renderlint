// Before/after pairs: everything shown comes from content/captures/<pair>/ (written by scripts/capture.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { site } from '../lib.mjs';

export const PAIRS = [
  {
    id: 'overflow', title: 'Text that doesn’t fit its box', rules: ['text-overflow', 'text-clipped'], post: 'text-overflow-clipped-text-responsive-layouts',
    lead: 'A billing page at 375px: a long email and a button label spill out of their card, and two KPI values are cut off by theirs.',
    beforeAlt: 'renderlint’s annotated screenshot at 375px: the Monthly spend and Invoices values cut off inside their cards (boxes 3 and 4, text-clipped), the email running past the account card and the button label cut off (boxes 1 and 2, text-overflow)',
    afterAlt: 'The fixed billing page at 375px: the cards stack, the full value $1,284,930.55 is shown, the email wraps inside the account card and the button fits its label',
    fix: '<code>overflow-wrap: anywhere</code> instead of <code>white-space: nowrap</code>, <code>min-width: 0</code> on the grid items, a fluid font size for the value and no fixed button width.',
  },
  {
    id: 'menu', title: 'A menu you can’t see', rules: ['popup-obscured'], post: 'dropdown-cut-off-overflow-hidden-z-index', shot: 'before-2.png',
    lead: 'renderlint opened the “Team actions” menu. Its card has <code>z-index: 1</code>, so the next card, with <code>z-index: 2</code>, is painted over the options.',
    beforeAlt: 'renderlint’s screenshot of the open Team actions menu: only “Invite people” shows, the next card (Usage this month) is drawn over the rest and boxed as popup-obscured',
    afterAlt: 'The fixed page: the Team actions menu is drawn over the next card with all three options, Invite people, Manage roles and Export members, visible',
    fix: 'The card that holds the open menu gets the higher z-index (<code>.card:has([aria-expanded=true]) { z-index: 10 }</code>), and the other card no longer clips with <code>overflow: hidden</code>.',
  },
  {
    id: 'unreachable', title: 'Content no one can scroll to', rules: ['unreachable-content'], post: 'content-you-cant-scroll-to',
    lead: 'An app shell with <code>height: 100vh; overflow: hidden</code>. The orders list grows past the screen, but its area is not a scroller.',
    beforeAlt: 'renderlint’s screenshot of an orders screen at 1280px: a dark sidebar and a column of order cards that stops at the bottom edge of the window, outlined in red as unreachable-content',
    afterAlt: 'The fixed orders screen at 1280px: the same list, now inside a scrolling area',
    fix: 'The area that grows scrolls: <code>flex: 1 1 0%; min-height: 0; overflow-y: auto</code>.',
  },
  {
    id: 'contrast', title: 'White text on a light gradient', rules: ['contrast'], post: 'color-contrast-gradients-images',
    lead: 'Every text on this weather card is white or near-white over a sky-blue gradient. Measured from the pixels behind each glyph, none reaches WCAG AA.',
    beforeAlt: 'renderlint’s screenshot at 768px: a weather card on a light-blue gradient, with the title, the description and each day tile boxed in red as contrast errors',
    afterAlt: 'The fixed weather card at 768px: the same white text on a dark blue gradient',
    fix: 'A darker gradient (<code>#1d4ed8</code> to <code>#1e3a8a</code>) so every stop the text sits on passes 4.5:1.',
  },
  {
    id: 'forms', title: 'Form controls built wrong', rules: ['dropdown-arrow', 'checkbox-layout', 'input-icon-overlap'], post: 'form-control-layout-bugs',
    lead: 'A search icon over the placeholder, a native select arrow 3px from the border, and a checkbox stretched by a global <code>input { width: 100% }</code>.',
    beforeAlt: 'renderlint’s screenshot of an alert-settings form: the search icon over the placeholder, the select arrow jammed against the border and a checkbox stretched above its label, each boxed',
    afterAlt: 'The fixed alert-settings form: padding before the placeholder, a custom chevron inset from the border, and the checkbox in a row with its label',
    fix: '<code>padding-left: 40px</code> on the search field, <code>appearance: none</code> with an inset chevron, and a flex row with a fixed-size checkbox.',
  },
  {
    id: 'loading', title: 'A blank card while the data loads', rules: ['loading-state'], post: 'loading-states-layout-shift',
    lead: 'renderlint held <code>GET /orders.json</code> for a second, as a slow network would. The “Recent orders” card showed nothing while it waited.',
    beforeAlt: 'renderlint’s side-by-side screenshot at 375px: left, one second into the held request, the Recent orders card is empty and boxed; right, the table that filled it once the data arrived',
    afterAlt: 'The fixed dashboard at 375px: the Recent orders table, which now shows skeleton rows while it loads',
    fix: 'Skeleton rows with <code>aria-busy="true"</code> until the data arrives, and an error message with a retry if the request fails.',
  },
  {
    id: 'dialog', title: 'The browser’s alert() box', rules: ['native-dialog'], post: 'replace-alert-confirm-prompt', noShot: true,
    lead: 'The page opens <code>alert("Your trial ends in 3 days")</code> on load. A native dialog can’t be screenshotted, so renderlint reports where it was called.',
    afterAlt: 'The fixed project settings page: the trial notice as an inline status message, and the delete confirmation as a styled modal dialog',
    fix: 'An inline status message for the notice, and a <code>&lt;dialog&gt;</code> opened with <code>showModal()</code> for the delete confirmation.',
  },
];

export function capture(id, file) {
  return fs.readFileSync(path.join(site, 'content', 'captures', id, file), 'utf8');
}

// A short excerpt of the real report: rule headers, the error/warn lines and where, and the summary.
export function excerpt(text, max = 3) {
  const out = [];
  let findings = 0;
  for (const l of text.split('\n')) {
    if (/^How to fix/.test(l)) break;
    if (/^[✖⚠] \S+ \(\d+\)/.test(l)) { out.push(l.replace(/^([✖⚠] \S+ \(\d+\)).*/, '$1')); continue; }
    if (/^\s+(error|warn)\s/.test(l)) { if (findings++ < max) out.push(l.length > 150 ? l.slice(0, 147) + '…' : l); else if (findings === max + 1) out.push('  …'); continue; }
    if (/^\s+at\s/.test(l) && findings <= max) { out.push(l.length > 120 ? l.slice(0, 117) + '…' : l); continue; }
  }
  const summary = text.trim().split('\n').pop();
  out.push('', summary.replace(/ · screenshots in .*/, ''));
  return out.join('\n');
}
