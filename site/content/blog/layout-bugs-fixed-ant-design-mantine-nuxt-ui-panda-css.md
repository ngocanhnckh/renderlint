---
title: Four layout bugs renderlint found in Ant Design, Mantine, Nuxt UI and Panda CSS
description: renderlint found layout bugs on the docs sites of Ant Design, Mantine, Nuxt UI and Panda CSS. Each fix was one to seven lines, and all four were merged.
slug: layout-bugs-fixed-ant-design-mantine-nuxt-ui-panda-css
date: 2026-11-22
tags: open-source, css, responsive, layout, flexbox
rule: viewport-overflow, text-overflow, element-overlap, content-overflow
---

renderlint found layout bugs on the documentation sites of four popular UI projects: Ant Design, Mantine, Nuxt UI and Panda CSS. Each bug only showed up at certain screen widths. Three made the page scroll sideways, and one let a code panel cover 218px of a live demo. Each fix changed between one and seven lines, and the maintainers merged all four within a day of the pull request being opened, between 19 and 20 November 2026. Together the four repositories have more than 145,000 GitHub stars, and their main npm packages were downloaded about 11.3 million times in one week.

- **Ant Design:** a media query without a unit never matched, so phones got the desktop layout. The fix was 7 lines.
- **Mantine:** a fixed `height` on a demo frame let a code panel cover 218px of the demo. The fix changed `height` to `min-height`.
- **Nuxt UI:** a flex item that could not shrink pushed the team page 79px past a 768px screen. The fix was one class.
- **Panda CSS:** flex items without `min-width: 0` made every docs page 97px too wide at 320px. The fix was one line.

## Which projects, and why do they matter?

All four are UI toolkits that other teams build products on, so their documentation sites get heavy daily use. Developers open them on phones and tablets as well as on desktops. The table shows each project's size on 22 November 2026, with npm downloads for 14 to 20 November 2026.

| Project | What it is | GitHub stars | Weekly npm downloads | Pull request |
|---|---|---|---|---|
| [Ant Design](https://github.com/ant-design/ant-design) | Enterprise-class design language and React UI library | 100,341 | 5,555,562 (`antd`) | [#59920](https://github.com/ant-design/ant-design/pull/59920) |
| [Mantine](https://github.com/mantinedev/mantine) | Fully featured React components library | 31,967 | 3,830,422 (`@mantine/core`) | [#9447](https://github.com/mantinedev/mantine/pull/9447) |
| [Nuxt UI](https://github.com/nuxt/ui) | Vue UI library built on Reka UI and Tailwind CSS | 7,099 | 1,097,010 (`@nuxt/ui`) | [#7445](https://github.com/nuxt/ui/pull/7445) |
| [Panda CSS](https://github.com/chakra-ui/panda) | Type-safe CSS-in-JS framework for design systems, from the Chakra UI team | 6,259 | 866,886 (`@pandacss/dev`) | [#4110](https://github.com/chakra-ui/panda/pull/4110) |

Ant Design passed 100,000 GitHub stars and is downloaded more than five million times a week. Mantine's core package is downloaded almost four million times a week. Nuxt UI is the component library of the Nuxt team. Panda CSS comes from the team behind Chakra UI and generates its styles at build time.

These are mature projects with active maintainers, and the bugs were still there. Visual bugs that depend on screen width are hard to catch in code review, because the code is valid and the page looks right at the width the author was using.

## How did renderlint find the bugs?

I ran renderlint against the live documentation sites of about 90 open-source projects, checking two or three pages per site at widths from 320 to 1440px. renderlint accepts any URL, so no source code or setup is needed for a first pass:

```bash
npx -y @yitec/renderlint https://ant.design/components/table --no-crawl --no-sweep
```

A scan of a live site gives many findings, and not all of them are worth a pull request. Low contrast, emoji icons and small tap targets show up on most sites, and maintainers often accept them as design choices. For this round I looked only for layout bugs with a clear cause and a small fix. I measured each one again in a fresh browser to rule out timing effects, and checked the issue tracker so I didn't duplicate someone else's work.

For the second round, which found the Panda CSS bug, I first screened each page with a short Playwright script. It compares `document.documentElement.scrollWidth` with the viewport width. I then ran renderlint on the pages that failed, to find the element responsible.

Every bug was then reproduced on the project's own dev server. renderlint was run there before and after the fix, and the pull request includes both reports. The before shots below have red boxes marking the problem, and the same screenshots are in each pull request.

## Ant Design: a media query that never matched

On ant.design, the component pages scrolled sideways on phones and small tablets. At 375px the Table page was 810px wide. The first demo was squeezed into a 163px column, and the table of contents, which is meant to disappear on small screens, stayed on top of the content.

![Ant Design's Table page at 375px. Before, the demo is squeezed into a narrow column with the table of contents drawn over the page. After, the demo uses the full width and the table of contents is hidden](oss/ant-design-table-375.png)
*Caption:* ant.design/components/table at 375px. Before: the demo is squeezed to 163px and the page is 810px wide. After: the phone layout applies.

### Why was the layout broken?

The docs theme had two mobile rules in `DocAnchor.tsx`. One hides the table of contents and the other narrows the article padding:

```tsx
@media only screen and (max-width: ${cssVar.screenLG}) {
  display: none;
}
```

In that context `screenLG` is the plain number 992. The CSS sent to the browser was `max-width: 992`, with no unit. A length in a media query needs a unit, except for zero, so the browser treats the condition as invalid and the block never applies. The `px` had been dropped in an earlier refactor, [#54563](https://github.com/ant-design/ant-design/pull/54563), in August 2025.

Below 992px the article therefore kept its desktop padding of `48px 164px`, and the fixed table of contents stayed on screen. Wide demos and the design-token tables could not shrink and could not scroll inside their own boxes, so they widened the whole page.

renderlint reported `viewport-overflow` on the token tables, along with many overlap and overflow findings in the squeezed demos:

```text
✖ viewport-overflow (2)  Content is wider than the viewport: the page scrolls sideways on phones, or content is cut off at the screen edge.
  error Element extends 79px beyond the 575px viewport and is cut off (overflow-x is hidden on the page).
        at div.ant-spin.css-dev-only-do-not-override-pbsm9t > div.ant-spin-container > div.ant-table.ant-table-medium > div.ant-table-container > div.ant-table-content > table  "Token Name Description Type Default Value contentFontSize Font size o…"
        in Table — /umi.js:1754
        page /components/button, /components/form · at 575px, 576px, 600px · see .renderlint/screens/components-button-1nhs4@575.png #7
```

### What was the fix?

The fix restored the unit, and let wide demos and tables scroll inside their own boxes below the same breakpoint:

```diff
-      @media only screen and (max-width: ${cssVar.screenLG}) {
+      @media only screen and (max-width: ${token.screenLG}px) {
```

```tsx
@media only screen and (max-width: ${token.screenLG}px) {
  /* existing rules for the demo columns … */

  .code-box-demo,
  ${token.antCls}-table-content {
    overflow-x: auto;
  }
}
```

At 375px the Button page went from 659px wide to 375px, the Form page from 626px to 375px, and the Menu page from 831px to 375px. Across the Table, Button and Form pages at four widths, renderlint went from 147 errors and 346 warnings to 45 errors and 200 warnings. The rest are mostly contrast findings that the fix doesn't touch. Nothing changes above 992px.

## Mantine: a fixed height under a stacked demo

On mantine.dev, the Combobox Transfer list example covered part of itself at phone widths. Below 755px the two lists stack vertically, and the second list (the one with the back button and a search box) disappeared under the code panel below the preview. 218px of the demo could not be seen or clicked.

![Mantine's Transfer list example at 375px. Before, the second list is hidden under the code panel. After, the preview grows and both lists are visible above the code](oss/mantine-transfer-list-375.png)
*Caption:* mantine.dev/combobox/?e=TransferList at 375px. Before: the second list is drawn under the code panel. After: the preview grows to fit both lists.

### Why did the code panel cover the demo?

The preview frame in `ComboboxDemo.module.css` had a fixed height of 600px. With 180px of top padding plus two stacked lists of about 250px each, the content needed about 680px. The overflow was visible, but the code panel below has `z-index: 2`, so it painted over the overflowing part.

renderlint reported it three ways: the list sticks out of the preview (`content-overflow`), it overlaps the code panel (`element-overlap`), and its text and buttons are under another element (`obscured-content`):

```text
✖ element-overlap (1)  Boxes that are laid out side by side (cards, buttons, images) overlap each other, typically after the viewport shrinks.
  error Element overlaps a neighbouring element by 319×218px.
        at div.ComboboxDemo-module__PyisYq__preview.right-scroll-bar-position:nth-of-type(1) > div.ComboboxDemo-module__PyisYq__inner:nth-of-type(2) > div.ComboboxDemo-module__PyisYq__wrapper > div.TransferList-module__mIVuiW__root > div:nth-of-type(2) > div.TransferList-module__mIVuiW__list:nth-of-type(2)  "🥦 Broccoli 🥕 Carrots 🥬 Lettuce"
      with div.ComboboxShell-module__sPwg4G__root > div > main > main.ComboboxShell-module__sPwg4G__main > div.ComboboxDemo-module__PyisYq__root > div.ComboboxDemo-module__PyisYq__code:nth-of-type(2)  "TransferList.tsx TransferList.module.css import { "
        in RenderList
        page /combobox/?e=TransferList · all viewports · see .renderlint/screens/combobox--e-TransferList-f206s@375.png #13
```

### What was the fix?

The fix was one word:

```diff
 .preview {
   background-color: light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7));
-  height: var(--preview-size);
+  min-height: var(--preview-size);
 }
```

`min-height` keeps the frame at 600px whenever the demo fits, so every width from 768px up renders exactly as before. When the demo is taller, the frame grows. After the change the second list ends exactly where the code panel starts, and the overlap findings are gone.

## Nuxt UI: a block that was not allowed to shrink

On ui.nuxt.com/team, the page scrolled sideways between 768px and about 850px. At 768px the page was 847px wide. The contribution counts in the contributors list were pushed past the right edge, so "79 contributions" read as "79 contr".

![Nuxt UI's team page at 768px. Before, the contribution counts run past the right edge of the screen. After, every row fits inside the viewport](oss/nuxt-ui-team-768.png)
*Caption:* ui.nuxt.com/team at 768px. Before: the contribution column overflows the screen by up to 79px. After: each row fits.

### Why did the rows overflow?

Each row is a flex container. The name and location block had `md:flex-none md:w-86`: from the `md` breakpoint it is 344px wide and `flex: none`, which means it can neither grow nor shrink. The `md` breakpoint is also where the social buttons appear. Avatar, rank, a 344px block, several social icons and the count did not fit in a container about 720px wide, and the only item that could have given way was not allowed to.

renderlint reported the overflow at 768px. Its stress pass also showed how close the layout was to breaking: with about 50% longer text, the same rows overflowed by 64px.

```text
✖ viewport-overflow (1)  Content is wider than the viewport: the page scrolls sideways on phones, or content is cut off at the screen edge.
  error Element extends 77px beyond the 768px viewport, causing horizontal page scroll. (×3 similar elements)
        at div > div.mt-8.pb-24 > section:nth-of-type(1) > ul.divide-y.divide-default > li.flex.items-center:nth-of-type(3) > div.ms-auto.flex:nth-of-type(3)  "79 contributions"
        page /team · at 768px · see .renderlint/screens/team-ryjnw@768.png #2
```

### What was the fix?

One Tailwind class, `flex-none` to `flex-initial`:

```diff
-<div class="flex-1 md:flex-none md:w-86 min-w-0 flex flex-col gap-0.5">
+<div class="flex-1 md:flex-initial md:w-86 min-w-0 flex flex-col gap-0.5">
```

`flex-initial` is `flex: 0 1 auto`. The block still asks for 344px, but it may now give up space when the row is too tight. The element already had `min-w-0`, and its name and location already truncate, so they get an ellipsis instead of pushing the row wider. From 1024px up the geometry is identical, because there is room for the full 344px. Benjamin Canac, who leads Nuxt UI, approved and merged it within an hour.

## Panda CSS: flex items without min-width: 0

On panda-css.com, the previous and next page cards at the bottom of the docs pushed the page sideways on phones. At 320px the page was 417px wide, which is 97px of horizontal scroll, and the "next" card was cut off at the right edge. It happened on most docs pages: 88 page and width combinations out of 133 pages checked at 320 and 375px.

![Panda CSS docs pagination at 320px. Before, the next-page card is cut off at the right edge. After, both cards fit side by side with truncated titles](oss/panda-css-pagination-320.png)
*Caption:* The previous and next cards on panda-css.com at 320px. Before: the row is 97px too wide. After: both cards shrink and their titles truncate.

### Why did the cards overflow?

Each card is a link with `flex: 1`. A flex item's default `min-width` is `auto`, which for most items means its content's minimum width, not zero. The card could not get narrower than its title, so the `truncate` class that was already on the title never had a chance to apply.

```text
✖ viewport-overflow (1)  Content is wider than the viewport: the page scrolls sideways on phones, or content is cut off at the screen edge.
  error Element extends 36px beyond the 375px viewport, causing horizontal page scroll.
        at #__next > main.pos_relative > div.d_flex.pos_relative:nth-of-type(2) > article.flex_1.min-w_0 > div.d_flex.ai_center:nth-of-type(4) > a.flex_1.d_flex:nth-of-type(2)  "Overview Thinking in Panda"
        in LinkComponent
        page /docs/get-started/why-panda, /docs/styling/patterns, /docs/theming/tokens · all viewports · see .renderlint/screens/docs-get-started-why-panda-1rblp@375.png #1
```

### What was the fix?

One line in `pagination.tsx`, using Panda's own `minW` shorthand:

```diff
       className={css({
         flex: '1',
+        minW: '0',
         display: 'flex',
```

The two cards now share the row and their titles truncate with an ellipsis, as the original code intended. Across all 133 docs pages, no pagination card extends past the screen at 320 or 375px any more, and 768px and up are unchanged. Segun Adebayo, the creator of Chakra UI, merged it.

## What do the four bugs have in common?

None of the four was a typo you could spot by reading the diff that introduced it. Each one was valid CSS that only went wrong at certain widths with real content.

| Project | renderlint rule | Cause | Fix | Lines changed |
|---|---|---|---|---|
| Ant Design | `viewport-overflow` | Media query length without a unit, so it never matched | Restore `px`; let demos scroll inside their box | +7 −2 |
| Mantine | `element-overlap`, `content-overflow` | Fixed `height` on a container whose content grows on phones | `min-height` instead of `height` | +1 −1 |
| Nuxt UI | `viewport-overflow`, `text-overflow` | Fixed-width flex item with `flex: none` | `flex: 0 1 auto` | +1 −1 |
| Panda CSS | `viewport-overflow` | Flex items with the default `min-width: auto` | `min-width: 0` | +1 −0 |

The table shows three patterns:

1. **Flex items that can't shrink.** Two of the four bugs came from flexbox defaults. `min-width: auto` and `flex-shrink: 0` are fine until the content is wider than you tested with. It was also the most common cause among the bugs these scans found, and it is covered in more detail in [How to find text overflow and clipped text in responsive layouts](/blog/text-overflow-clipped-text-responsive-layouts/).
2. **Fixed heights on containers with variable content.** A height that fits the desktop layout is wrong as soon as the layout stacks. `min-height` keeps the design and removes the failure.
3. **Rules that silently do nothing.** An invalid media query raises no error in the console, and nothing in the build reports it. The only symptom is the rendered page. That is exactly the kind of bug a source linter can't see.

## How renderlint catches these bugs

renderlint loads each page in headless Chromium at several widths and measures the rendered boxes. It reports a finding when an element extends past the viewport, sticks out of its container, overlaps a sibling, or sits under another opaque element. The rules involved here are [`viewport-overflow`](/rules/#viewport-overflow), [`text-overflow`](/rules/#text-overflow), [`content-overflow`](/rules/#content-overflow), [`element-overlap`](/rules/#element-overlap) and [`obscured-content`](/rules/#obscured-content).

Two parts of the method mattered for these bugs:

- **More widths than you would check by hand.** The Nuxt UI bug existed only between 768 and about 850px. renderlint's default sweep also checks 13 widths from 320 to 1920px, plus both sides of every breakpoint the page uses.
- **Content that is longer than the sample.** The stress pass re-runs the layout rules with about 50% longer text, long unbreakable strings and bigger numbers. It reports layouts that fit today but are within a few pixels of breaking, as it did on the Nuxt UI team page.

renderlint has limits. A scan of a live site also reports findings that are not worth fixing, or that are false positives: elements scrolled under a sticky header, icon-font ligatures measured as text, and third-party widgets. Bugs that only appear after a hover, a click or a drag are outside a plain scan unless you list those states in the config or reach them in a Playwright test. The [README's Limitations section](https://github.com/ngocanhnckh/renderlint#limitations) lists the rest. Every finding in this article was checked in a fresh browser before a pull request was opened.

To run the same check on your own site, point renderlint at a running dev server or a static build. It exits with code 1 when it finds an error, so it can gate a build or a CI job; see [Get started](/get-started/).

## Frequently asked questions

### Why do so many documentation sites scroll sideways on phones?

Docs sites are full of content that can't shrink: code samples, API tables, long identifiers and side-by-side cards. Each one sets a minimum width for its container. When a flex or grid item doesn't allow shrinking (`min-width: auto` is the default), that minimum width spreads up to the page and the whole page becomes wider than the screen.

### What does min-width: 0 do on a flex item?

It lets the item shrink below the width of its content. By default a flex item's minimum width is `auto`, which resolves to its content's minimum width, so a long title or code string keeps it wide. With `min-width: 0` the item can get narrower, and `overflow`, `text-overflow: ellipsis` or wrapping inside it start to work.

### Can a media query use a CSS variable?

No. `var()` is not allowed in media query conditions, and a length other than zero needs a unit. `@media (max-width: var(--bp))` and `@media (max-width: 992)` are both invalid, and the browser ignores the block without a console warning. Write the value in the stylesheet (`992px`), or generate it at build time as Ant Design does.

### Does renderlint need the project's source code?

No. It can check any URL, including a production site, which is how these bugs were found. Run against a local dev server, it can also name the component or source file behind a finding, which makes the fix faster to locate.
