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
  'unreachable-content': {
    severity: 'error',
    category: 'layout',
    summary: 'Content lies below the bottom of a box that clips (`overflow: hidden` or `clip`), or below the screen on a page that doesn\'t scroll, and nothing around it scrolls: users can never see it. Typical causes: a fixed-height app shell (`height: 100vh; overflow: hidden`) whose page or tab area isn\'t a scroller, or a scroll lock (`body { overflow: hidden }`) left on. Before reporting, renderlint turns the mouse wheel over the box: content that a script scrolls is not reported. Not reported: content moved away on purpose (transformed, absolute or fixed), small boxes (teasers, collapsed panels), boxes with a "Show more" control, faded or line-clamped text, and the page while a dialog is open.',
    fix: 'Make the area that grows scroll: `overflow-y: auto` on it, and in a flex or grid layout let it shrink to the space it has (`flex: 1 1 0%; min-height: 0`, or `min-height: 0` on the grid row) so it doesn\'t just grow past its parent. Or remove the fixed height so the page scrolls. Remove a scroll lock when what set it closes.',
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
  'loading-state': {
    severity: 'warn',
    category: 'ux',
    summary: 'An area of the page stays blank while its data loads: no spinner, skeleton, progress bar or "Loading…" text, so on a slow connection the page looks empty, broken or frozen. renderlint reloads each page with its fetch/XHR requests held for a second (as on a slow network), looks at what is shown, releases them and finds the areas the data filled. Any loading sign on the page counts: aria-busy, role=progressbar/status, a running animation, motion on screen, "Loading…"/"Saving…" text, skeleton or spinner class names, placeholder blocks where the content appears. With `--ux`, also checked after each click.',
    fix: 'Render a loading state where the data will appear until it arrives: a skeleton shaped like the content (best: no layout jump), or a spinner. With TanStack Query / SWR use isPending / isLoading; with React Suspense a fallback; with React Router loaders useNavigation(); in Next.js a loading.tsx. Show an error message if the request fails.',
  },
  'action-feedback': {
    severity: 'warn',
    category: 'ux',
    summary: 'After a click (a button, tab, link or form submit), the request it starts takes a while and nothing on screen changes meanwhile: the page looks frozen, and users click again or leave. Checked by `--ux`, which holds the request for a second (Nielsen: past 1s users lose the feeling of direct control). Covers in-app page changes too (React Router loaders, Next.js navigation without loading.tsx).',
    fix: 'Respond to the click at once: a pending state on the control (spinner, "Saving…", disabled) or where the result will appear (skeleton, dimmed old content with aria-busy, a top progress bar for page changes: useNavigation(), Next.js loading.tsx, NProgress), then the result.',
  },
  'ui-freeze': {
    severity: 'warn',
    category: 'ux',
    summary: 'The page could not respond or repaint for 500ms or more: a long task blocked the main thread while loading, or after a click (Interaction to Next Paint over 500ms is rated poor). Checked by `--ux`.',
    fix: 'Find the long task in the Performance panel. Move heavy computation to a Web Worker, split work into chunks that yield (await scheduler.yield() / setTimeout), virtualize long lists, and in React wrap slow updates in startTransition so feedback paints first.',
  },
  'error-feedback': {
    severity: 'warn',
    category: 'ux',
    summary: 'When a request fails, nothing tells the user: the page shows less (or keeps its spinner forever) on load, or an action seems to succeed. `--ux` answers the page\'s data requests, and each action\'s, with HTTP 500 and looks for an error message, an alert or a changed control.',
    fix: 'Handle the failed request in the UI: an error message where the content would be, or a toast / inline error for an action, saying what went wrong and offering a retry; stop the loading state and re-enable the control. (TanStack Query isError, SWR error, a catch that sets error state, an error boundary.)',
  },
  'double-submit': {
    severity: 'warn',
    category: 'ux',
    summary: 'Clicking a submit or save button twice while its request is pending sends it twice: duplicate orders, payments or messages. Checked by `--ux` on actions that change data (POST, PUT, PATCH, DELETE; renderlint answers them itself, nothing reaches the server).',
    fix: 'Disable the button (or ignore clicks) while the request is in flight, and show that it is working ("Saving…"). For payments and orders, also send an idempotency key.',
  },
  'dead-control': {
    severity: 'warn',
    category: 'ux',
    summary: 'A button that does nothing a user can see when clicked: no request, no change on screen, no navigation, dialog or download. Checked by `--ux`.',
    fix: 'Fix the handler (missing, failing, or attached to another element). If the result is invisible (copied to the clipboard, saved in the background), confirm it with a "Copied" label or a toast. A placeholder button should be disabled or removed.',
  },
  'slow-render': {
    severity: 'warn',
    category: 'ux',
    summary: 'The page\'s main content appears more than 4s after navigation (Largest Contentful Paint, measured by `--ux` on a reload from the local server with a warm cache; Core Web Vitals rates over 4s as poor).',
    fix: 'Find what delays the content: request waterfalls (requests that wait for each other: start them together, or fetch on the server), a large bundle before the first render (code-split routes, lazy-load heavy components), or render-blocking resources.',
  },
  'layout-shift': {
    severity: 'warn',
    category: 'ux',
    summary: 'Content jumps around while the page loads (Cumulative Layout Shift over 0.1, the Core Web Vitals limit for "good"): text and buttons move as data and images arrive, so users lose their place or click the wrong thing. Measured while the loading-state check holds the page\'s data for a second and releases it.',
    fix: 'Reserve the space before the content arrives: a skeleton the size of the content, width and height (or aspect-ratio) on images, video and embeds, min-height on areas filled by data, and no banners inserted above existing content.',
  },
  'empty-state': {
    severity: 'warn',
    category: 'ux',
    summary: 'With no data yet (a new account, a filter that matches nothing), a list, table or chart is just empty, keeps loading, or the page breaks: nothing says there is nothing yet. `--ux` reloads the page with every list of records in its JSON responses emptied (`{ "items": [], "total": 0 }`: arrays of objects with an id, but not the user’s roles, flags, settings, menus or lookup lists; renderlint answers, nothing changes on the server) and looks for a message where the content was. A section hidden entirely, title and all, is left alone.',
    fix: 'Render an empty state where the content would be: a short message ("No orders yet") and, when the user can add one, the action that does it ("Create order"). Guard code that assumes at least one record (items[0].name, reduce() with no initial value, a chart with no points).',
  },
  'dialog-focus': {
    severity: 'warn',
    category: 'ux',
    summary: 'A dialog opened by a click doesn\'t handle focus as users expect (WAI-ARIA dialog pattern, WCAG 2.4.3): focus stays on the page behind it, Escape doesn\'t close it, or when it closes focus drops to the top of the page instead of returning to the control that opened it. Checked by `--ux` on the modal dialogs its clicks open (`<dialog>` with `showModal()`, `aria-modal`, `alertdialog`, or a dialog over a full-screen overlay).',
    fix: 'Use a dialog that manages focus: the `<dialog>` element opened with `showModal()`, or Radix / Headless UI / MUI / Angular CDK dialogs. By hand: focus the first field (or the close button) on open, close on Escape, and on close call `.focus()` on the element that opened it.',
  },
  'back-navigation': {
    severity: 'warn',
    category: 'ux',
    summary: 'After an in-app link (a client-side route change), the browser\'s Back button doesn\'t bring the previous page back: the route change replaced the history entry, so Back skips the page, or the address changes back while the page keeps showing the new one (the app ignores popstate). Checked by `--ux` on in-app links that change the route.',
    fix: 'Navigate with the router\'s own links and push navigation (`<Link>`, `router.push`, `navigate(path)`); keep `replace` for redirects. If you change the URL with `history.pushState` yourself, render the matching view on `popstate`.',
  },
  'popup-obscured': {
    severity: 'error',
    category: 'overlap',
    summary: 'An open dropdown, menu, listbox or popover can\'t be seen: it is cut off by a container\'s `overflow: hidden` / `auto` (a card, a table wrapper), or drawn underneath a later element because of z-index and stacking order. renderlint opens the menu triggers on each page (`aria-haspopup`, comboboxes, Bootstrap dropdowns, `<details>`) to check, and checks menus already open in `states` and Playwright tests.',
    fix: 'Render the menu outside the clipping container: in a portal or the top layer (Radix / shadcn `Portal`, Headless UI `anchor`, MUI Popper / Menu (portal by default), Angular CDK Overlay, the `popover` attribute, Floating UI with `strategy: "fixed"` outside transformed ancestors). Or remove `overflow: hidden` from the ancestor. For "drawn underneath": raising the menu\'s own z-index doesn\'t help while an ancestor starts a stacking context (z-index on a positioned card, transform, filter, opacity < 1); give that ancestor the higher z-index while the menu is open, or portal the menu out.',
  },
  'native-dialog': {
    severity: 'error',
    category: 'polish',
    summary: 'The app uses the browser\'s own alert(), confirm() or prompt() box: a grey system dialog that blocks the page, ignores the app\'s design and can\'t be styled or translated. Found when one opens while a page is checked, and in source code (`window.confirm(…)`, `alert(…)`), which also catches the ones behind a click. The browser\'s "Leave site?" prompt from `beforeunload` is not flagged.',
    fix: 'Use the app\'s own UI: a toast or snackbar for notices ("Saved"), an inline message next to the field for validation errors, and a modal dialog component for confirmations ("Delete this project?") and for asking for a value (the <dialog> element, Radix / shadcn AlertDialog, Headless UI Dialog, Angular Material MatDialog, Vuetify v-dialog…). If one is really intended, add `// renderlint-ignore native-dialog` on the line above.',
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
    summary: 'A page renderlint was asked to check sent it to a login page or identity provider instead, so the page itself was never checked. A warning for pages found by crawling, and for a home page that is the sign-in page (which is then checked itself). Any other page the app didn\'t show is `page-not-shown`.',
    fix: 'Add "auth" to renderlint.config: log in once with `auth: { login: "/login", user: "${RENDERLINT_USER}", password: "${RENDERLINT_PASSWORD}" }`, or, frontend only with no backend, set what the route guard reads (`auth: { storage: { sessionStorage: { "token": "test" } } }`) and serve the API with `mock`. For a role: give it a session the app accepts (its storage or login under `roles.<name>`). See docs/authentication.md.',
  },
  'page-not-shown': {
    severity: 'warn',
    category: 'runtime',
    summary: 'Signed in, the app did not show a page renderlint was asked to check or found (in a link or the app\'s routes), so it was not checked: a guard redirected elsewhere, the server answered HTTP 401/403, or "Access denied" / "Page not found" was rendered in its place. With several roles, a page one role sees and another does not. An error for a page you listed that no role could see, and for a page in a role\'s own `pages`. Not flagged: the home page forwarding, a section\'s default child, trailing slashes, locale prefixes, and a redirect every role takes the same way.',
    fix: 'If the role is not meant to see the page, list it in `roles.<role>.deny` (e.g. ["/admin/**"]) and it is recorded as denied as expected. Otherwise give that role what the guard checks (its storage, a forged token `{ "$jwt": { "role": "admin" } }`, or `roles.<role>.mock`, e.g. `/api/me` answering with that role), or for a dynamic route set `params` to a value that exists. See docs/roles-and-coverage.md.',
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

// What to put in place of a native dialog, in the finding itself, so an agent reading one line knows the change to make.
export function dialogAdvice(type) {
  const reuse = 'Use the toast/dialog component the project already has (search for one: sonner, react-hot-toast, a components/ui/dialog, MatDialog / MatSnackBar, ElMessageBox…) before adding a library.';
  if (type === 'alert') return `Replace it with the app's own toast or snackbar ("Saved"), or with an inline message next to the field for a form error. ${reuse}`;
  if (type === 'prompt') return `Replace it with the app's own modal (or inline form) with a text input, and continue when it is submitted. ${reuse}`;
  return `Replace it with the app's own confirmation modal and continue only when the user confirms there (e.g. \`if (await confirmDialog({ title: 'Delete this project?', confirmLabel: 'Delete' }))\`, an AlertDialog with Cancel / Delete). ${reuse}`;
}

export const IGNORE_HELP =
  'If a finding is intentional, mark the element: data-renderlint-ignore="<rule>" (space-separated, or empty for all rules), ' +
  'or in CSS: --renderlint-ignore: <rule>; — both apply to the element and its descendants. Add data-renderlint-reason="…" to explain why.';
