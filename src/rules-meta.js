// renderlint-ignore-file (describes placeholder/emoji rules, so it mentions their trigger words)
// Rule catalogue: default severity, what it catches, and how to fix it.
// This is the single source of truth for docs, `renderlint explain` and report hints.

export const RULES = {
  'text-overflow': {
    severity: 'error',
    category: 'layout',
    summary: 'Text spills outside the box (card, button, badge, input) that is supposed to contain it.',
    fix: 'Let the text wrap: remove fixed widths/heights or `white-space: nowrap`, add `overflow-wrap: anywhere` (Tailwind `break-words`) for long words/URLs, and use `min-width: 0` on flex/grid children so they can shrink.',
  },
  'text-crowding': {
    severity: 'error',
    category: 'layout',
    summary: 'Text still fits inside its card, button or badge, but has run through the side padding and nearly touches the edge (a KPI number, a long label).',
    fix: 'Give the text room to shrink or wrap: `min-width: 0` and `overflow-wrap: anywhere` on flex/grid children, a fluid font size for big numbers (`font-size: clamp(1.5rem, 4cqi, 2.5rem)` with `container-type: inline-size` on the card), fewer columns at that width, or a shorter format (`4.9K`).',
  },
  'text-clipped': {
    severity: 'error',
    category: 'layout',
    summary: 'Text is partially cut off by an `overflow: hidden` container or the edge of an <svg> (e.g. chart axis labels).',
    fix: 'Give the container room (remove fixed height, add padding), allow wrapping, or truncate intentionally with `text-overflow: ellipsis` / `line-clamp`. For SVG charts increase the chart margin/padding or rotate/shorten labels.',
  },
  'content-overflow': {
    severity: 'error',
    category: 'layout',
    summary: 'A child element (image, button, inner card) sticks out of its visible container.',
    fix: 'Constrain the child (`max-width: 100%`, `min-width: 0` on flex children, `flex-wrap: wrap`) or let the container grow instead of using a fixed size.',
  },
  'viewport-overflow': {
    severity: 'error',
    category: 'responsive',
    summary: 'Content is wider than the viewport: the page scrolls sideways on phones, or content is cut off at the screen edge.',
    fix: 'Replace fixed pixel widths with fluid ones (`max-width: 100%`, `w-full`), make rows wrap (`flex-wrap`), collapse grids to fewer columns at small breakpoints (`grid-cols-1 md:grid-cols-3`), and break long words.',
  },
  'accidental-scrollbar': {
    severity: 'error',
    category: 'layout',
    summary: 'A scroll container overflows by only a few pixels, showing a pointless scrollbar.',
    fix: 'Fix the few pixels of overflow (often padding + fixed height, or 100vh/100vw plus margins) or use `overflow: hidden`/`visible` if scrolling is not intended.',
  },
  'text-overlap': {
    severity: 'error',
    category: 'overlap',
    summary: 'Two pieces of text are drawn on top of each other — overlapping labels in charts, diagrams, absolutely positioned captions, or collapsed layouts.',
    fix: 'Give elements space (no fixed heights, avoid absolute positioning for flowing content). For charts: reduce tick count, rotate or truncate labels, increase chart margins, or use a legend instead of inline labels.',
  },
  'element-overlap': {
    severity: 'error',
    category: 'overlap',
    summary: 'Boxes that are laid out side by side (cards, buttons, images) overlap each other, typically after the viewport shrinks.',
    fix: 'Use flex-wrap/grid with responsive columns instead of fixed widths; remove fixed heights that force content into the next element.',
  },
  'obscured-content': {
    severity: 'error',
    category: 'overlap',
    summary: 'Text or a control is hidden underneath another opaque element (fixed header covering the hero, absolutely positioned image over a button).',
    fix: 'Offset content below fixed/sticky headers (padding-top / scroll-margin), fix z-index stacking, or reposition the covering element.',
  },
  contrast: {
    severity: 'error',
    category: 'color',
    summary: 'Text does not have enough contrast with what is actually behind it (WCAG AA: 4.5:1, or 3:1 for large text). Measured from real rendered pixels, so it works over gradients and images.',
    fix: 'Use the suggested color (or darker/lighter), change the background, or add an overlay/scrim behind text on images. Check dark mode separately.',
  },
  emoji: {
    severity: 'error',
    category: 'polish',
    summary: 'Emoji used as icons or decoration in the interface.',
    fix: 'Replace emoji with icons from a real icon set rendered as SVG (lucide, heroicons, phosphor, tabler, material symbols…). If emoji are genuinely content (chat messages, user input), mark the element with data-renderlint-ignore="emoji".',
  },
  'placeholder-text': {
    severity: 'error',
    category: 'content',
    summary: 'Leaked placeholders or broken data: [object Object], undefined, NaN, Invalid Date, {{template}}, lorem ipsum, TODO. On WordPress sites also the sample content ("Hello world!", "Just another WordPress site") and Elementor\'s default widget texts ("Add Your Heading Text Here").',
    fix: 'Render real content: fix the data binding / formatting, provide fallbacks for missing values, and replace lorem ipsum with real copy. WordPress: delete the sample post, page and comment, and set a tagline (Settings > General) or remove it from the theme.',
  },
  'broken-image': {
    severity: 'error',
    category: 'content',
    summary: 'An image failed to load or has no src.',
    fix: 'Fix the path/URL (check the public/static folder and base path) or remove the image.',
  },
  'image-distortion': {
    severity: 'error',
    category: 'content',
    summary: 'An image is rendered at a different aspect ratio than its natural one (stretched or squashed).',
    fix: 'Set only one dimension (`height: auto`) or use `object-fit: cover` / `contain` with a fixed box.',
  },
  'oversized-icon': {
    severity: 'error',
    category: 'polish',
    summary: 'An icon-sized SVG (viewBox ≤ 48) renders huge because it has no width/height, so it stretches to fill its container.',
    fix: 'Give icons an explicit size: width/height attributes or CSS (e.g. `width: 1.25rem; height: 1.25rem`, Tailwind `size-5`), and `flex-shrink: 0` in flex rows.',
  },
  'invisible-content': {
    severity: 'error',
    category: 'content',
    summary: 'In-flow content (text) that is still transparent or `visibility: hidden` after scrolling through the page, leaving a blank gap: usually a scroll-reveal animation that never fires (IntersectionObserver threshold too high for tall sections on phones, a missing "visible" class, or an Elementor/WOW.js entrance animation whose script was delayed by an optimisation plugin or broken by a JavaScript error).',
    fix: 'Use a low IntersectionObserver threshold (0–0.15) or rootMargin, reveal elements already in view on load, and make content visible by default when JS or animations are unavailable (prefers-reduced-motion). WordPress: exclude Elementor\'s frontend scripts (and jQuery) from "delay JavaScript" in WP Rocket/Perfmatters/LiteSpeed, check the console for errors, or remove the entrance animation.',
  },
  'missing-alt': {
    severity: 'warn',
    category: 'a11y',
    summary: 'An <img> has no alt attribute.',
    fix: 'Add a short description (`alt="Team photo"`) or `alt=""` if the image is decorative.',
  },
  'dead-link': {
    severity: 'warn',
    category: 'content',
    summary: 'A link with href="#" (or none) and no click handler: a CTA that goes nowhere.',
    fix: 'Point it at a real route/anchor, attach a handler, or use a <button> for actions.',
  },
  'nested-interactive': {
    severity: 'error',
    category: 'a11y',
    summary: 'A link or button nested inside another link or button (invalid HTML; causes hydration errors and unpredictable clicks).',
    fix: 'Restructure so interactive elements are siblings (e.g. stretched-link pattern with a positioned ::after).',
  },
  'missing-viewport-meta': {
    severity: 'error',
    category: 'responsive',
    summary: 'No <meta name="viewport"> tag, so mobile browsers render the page zoomed out at desktop width.',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.',
  },
  'tap-target': {
    severity: 'warn',
    category: 'a11y',
    summary: 'A button/link is smaller than 24×24px (WCAG 2.2 AA), hard to hit on touch screens.',
    fix: 'Increase padding or min-width/min-height (44×44px recommended for primary touch targets).',
  },
  'font-size-min': {
    severity: 'warn',
    category: 'readability',
    summary: 'Text smaller than 12px.',
    fix: 'Use at least 12px (14–16px for body text).',
  },
  'unlabeled-control': {
    severity: 'warn',
    category: 'a11y',
    summary: 'An icon-only button/link or a form field without an accessible name.',
    fix: 'Add aria-label to icon buttons, and a <label> (or aria-label) to form fields.',
  },
  'button-text-wrap': {
    severity: 'warn',
    category: 'polish',
    summary: 'A short button label breaks onto multiple lines.',
    fix: 'Shorten the label, allow the button to grow (remove fixed width), or use `white-space: nowrap` with enough room.',
  },
  'line-length': {
    severity: 'warn',
    category: 'readability',
    summary: 'Paragraph lines are very long (>120 characters), which is tiring to read.',
    fix: 'Constrain text width, e.g. `max-width: 65ch` (Tailwind `max-w-prose`).',
  },
  'focus-indicator': {
    severity: 'warn',
    category: 'a11y',
    summary: 'A focusable element shows no visible change when focused (outline removed without replacement).',
    fix: 'Keep the outline or add a `:focus-visible` style (e.g. Tailwind `focus-visible:ring-2`).',
  },
  'fragile-layout': {
    severity: 'warn',
    category: 'responsive',
    summary: 'Stress test: the layout breaks with content the sample data doesn\'t have yet: ~50% longer text, long unbreakable emails/URLs/IDs, numbers with three more digits, longer API data, or the worst case declared with data-renderlint-maxlength / data-renderlint-sample (that last one is an error).',
    fix: 'Design for longer content: allow wrapping, avoid fixed heights/widths on text containers, add `min-width: 0` to flex children and `overflow-wrap: anywhere` for long words.',
  },
  'dropdown-arrow': {
    severity: 'error',
    category: 'forms',
    summary: 'A dropdown\'s arrow sits much closer to the border than its text does to the other side, so it looks jammed against the edge. Measured from pixels, so it covers native arrows, background-image chevrons and custom triggers.',
    fix: 'Chrome and Safari draw the native arrow near the border and ignore padding-right. Use `appearance: none` with your own chevron, e.g. `background: url(chevron.svg) no-repeat right 12px center; padding-right: 40px`, or position an icon inside the padding. Keep the arrow\'s right inset close to the text\'s left inset.',
  },
  'checkbox-layout': {
    severity: 'error',
    category: 'forms',
    summary: 'A checkbox or radio button is stretched to the full width (drawn in the middle, away from its label), or sits on its own row above its label.',
    fix: 'Scope full-width input styles to text fields (`input:not([type=checkbox]):not([type=radio])`), give checkboxes `width: auto` (Tailwind `w-4 h-4 shrink-0`), and put the box and label in a row: `display: flex; align-items: center; gap: 8px` (or `items-start` for multi-line labels).',
  },
  'input-icon-overlap': {
    severity: 'error',
    category: 'forms',
    summary: 'An icon (search, mail, calendar) is drawn over the part of an input where its text and placeholder appear, so typed text runs underneath it.',
    fix: 'Add padding on the icon\'s side so the text starts after it: e.g. `padding-left: 40px` (Tailwind `pl-10`) for a 16px icon at `left: 12px`, or `pr-10` for a trailing icon.',
  },
  'squashed-control': {
    severity: 'error',
    category: 'forms',
    summary: 'An input or select is too short for its text: height minus vertical padding leaves less room than the font needs, so the text is cut off at the top and bottom.',
    fix: 'Remove the fixed height or reduce vertical padding: use either `height` with `padding-block: 0`, or padding with `height: auto`. A 16px font needs about 20px of content height.',
  },
  'control-height-mismatch': {
    severity: 'warn',
    category: 'forms',
    summary: 'Controls placed side by side (an input and its button, a select next to a text field) have different heights, so their edges don\'t line up.',
    fix: 'Give controls in a row the same height (e.g. `h-10` on both), or let the row stretch them: `display: flex; align-items: stretch`.',
  },
  'icon-misaligned': {
    severity: 'warn',
    category: 'polish',
    summary: 'An icon next to a single line of text sits visibly above or below the text\'s center (an inline SVG on the baseline, or a larger icon next to small text).',
    fix: 'Lay the icon and text out with `display: inline-flex; align-items: center; gap: 6px`, and give the icon `flex-shrink: 0`.',
  },
  'page-error': {
    severity: 'error',
    category: 'runtime',
    summary: 'The page could not be loaded or analyzed: navigation failed, timed out, or returned an HTTP error (4xx/5xx).',
    fix: 'Make sure the page exists and the server is running (check the URL, routes and `serve` command), then fix any server error.',
  },
  'auth-required': {
    severity: 'error',
    category: 'runtime',
    summary: 'A page renderlint was asked to check sent it to a login page or identity provider instead, so the page itself was never checked. A warning for pages found by crawling, and for a home page that is the sign-in page (which is then checked itself). With `roles`, also a page listed for a role that the app didn\'t show it (sent elsewhere, HTTP 401/403, or only an "Access denied" heading).',
    fix: 'Add "auth" to renderlint.config: log in once with `auth: { login: "/login", user: "${RENDERLINT_USER}", password: "${RENDERLINT_PASSWORD}" }`, or, frontend only with no backend, set what the route guard reads (`auth: { storage: { sessionStorage: { "token": "test" } } }`) and serve the API with `mock`. For a role: give it a session and mocks that grant the page (`roles.<name>.auth`, `roles.<name>.mock`, e.g. `/api/me` answering with that role). See docs/authentication.md.',
  },
  'console-error': {
    severity: 'error',
    category: 'runtime',
    summary: 'Uncaught JavaScript error or console.error while rendering (hydration mismatches, crashed components).',
    fix: 'Open the page, read the error, and fix the underlying bug.',
  },
  'broken-resource': {
    severity: 'error',
    category: 'runtime',
    summary: 'A same-origin stylesheet, script, font or image request failed (404/500), or a web font failed to load.',
    fix: 'Fix the asset path or remove the reference.',
  },
};

export const RULE_IDS = Object.keys(RULES);

export const IGNORE_HELP =
  'If a finding is intentional, mark the element: data-renderlint-ignore="<rule>" (space-separated, or empty for all rules), ' +
  'or in CSS: --renderlint-ignore: <rule>; — both apply to the element and its descendants. Add data-renderlint-reason="…" to explain why.';
