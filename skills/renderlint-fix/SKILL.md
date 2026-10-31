---
name: renderlint-fix
description: Fix the UI defects renderlint reports (text overflow, contrast, overlap, broken mobile layouts, fragile-layout, page-not-shown, auth-required, coverage gaps). Use after `npx renderlint` or the renderlint Stop hook reports errors, or before saying a UI task is done.
---

# Fix what renderlint reports

`npx renderlint` exits 1 while errors remain. Fix every error, re-run, and repeat until it reports `0 errors`. Treat it like a failing build.

## Read the report

Each finding has:
- the rule;
- the element (a CSS selector, plus the component and file when renderlint can map it);
- the page, the role (`[role: viewer]`) and the widths (`@375px`; `@1024px` comes from the width sweep);
- a numbered marker on a screenshot in `.renderlint/screens/`. **Open the screenshot when a finding isn't obvious.**

`npx renderlint explain <rule>` explains any rule. `.renderlint/report.json` has the same data for scripts.

## Fix root causes, not symptoms

| Rule | Usual cause | Fix |
|---|---|---|
| `text-overflow`, `text-clipped`, `text-crowding` | Fixed width or height on a text box, `white-space: nowrap`, a flex child without `min-width: 0` | Let text wrap. Remove fixed sizes, use `min-width: 0` on flex/grid children, add `overflow-wrap: anywhere` where emails, URLs or ids appear. |
| `viewport-overflow` | Something wider than the phone screen: fixed px widths, a table, a long unbroken word | Make it fluid (`max-width: 100%`, `minmax(0, 1fr)`), wrap rows (`flex-wrap`), put wide tables in a scroll container. |
| `contrast` | Light text on a light accent, gray-on-gray, text over an image | Darken the text or lighten the background until it passes. The finding suggests a passing color. |
| `text-overlap`, `element-overlap` | Absolute positioning, negative margins, overlapping grid areas | Lay elements out in flow; reserve space for labels. |
| `fragile-layout` | Passes with the sample data, breaks with longer text, long words, bigger numbers or longer API data | Same fixes as overflow: the design must survive real content. |
| `page-not-shown` | Signed in, the app didn't show the page: a guard redirected, HTTP 401/403, or "Access denied" / "Not found" | Either the role isn't meant to see it (add the path to that role's `deny`), or it is (give the role what the guard checks). See the `renderlint-setup` skill. |
| `auth-required` | The page sent renderlint to the login page, so it was never checked | Set up `auth` (`renderlint-setup` skill). Don't ask the user for credentials and don't turn the rule off. |
| coverage below `coverage.min` | Routes that were found but not checked | Read the reasons in `.renderlint/coverage.json` and fix them as the `renderlint-setup` skill describes. |

Don'ts:
- Don't hide symptoms: no `overflow: hidden` on `body` to mask sideways scrolling.
- Don't shrink text below 12px, and don't delete content to dodge a rule.
- Don't add `!important` piles.

When the same component is flagged on many pages, fix the component once.

## Intentional? Say so, rarely

If a finding is really intended (a decorative marquee, a deliberately cropped hero image), mark the element:

```html
<div data-renderlint-ignore="text-clipped" data-renderlint-reason="ticker scrolls on purpose">…</div>
```

or in CSS, `--renderlint-ignore: text-clipped;`. Always give the reason. These are reviewed like `eslint-disable`. Never use `"rules": { "x": "off" }` or `ignore` to make a run pass. `page-not-shown`, `auth-required` and coverage gaps are never "intentional": they mean pages went unchecked.

## Declare worst cases you know about

When a field has a known limit, tell renderlint so it tests exactly that, and failures become errors:

```html
<h3 data-renderlint-maxlength="60">{project.name}</h3>
<span data-renderlint-sample="Aleksandra Wiśniewska-Kowalczyk">{user.name}</span>
```

Details: [docs/rules.md](https://gitlab.com/anhnn.a05/renderlint/-/blob/master/docs/rules.md).
