# Astro

Routes are read from `src/pages`: `.astro`, `.md` and `.mdx` pages, `[param]` and `[...rest]` routes, literal `getStaticPaths`, and content collections.

```bash
astro build && npx renderlint dist          # static output
npx renderlint --serve "npx astro preview --port 4319" --url http://localhost:4319
```

- **Islands** (React, Vue, Svelte, Solid components) are checked as they render on the page, after hydration.
- **Dynamic routes:** values come from literal `getStaticPaths`, content collections, the built pages, the sitemap, and links. Otherwise set `params`.
- **On-demand rendering** (`output: 'server'` with a Node adapter): `mock` also answers the server's requests when renderlint starts the server, as for other Node SSR frameworks ([server mocks](../server-mocks.md)).

Tested: route discovery on a generated Astro site with 120+ routes (every route found and rendered), and read-only discovery on the astro.build source. Astro's on-demand rendering with a login and server mocks wasn't tested. It uses the same Node `fetch` the server mocks intercept, but treat it as unverified.
