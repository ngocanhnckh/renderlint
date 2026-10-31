# Static sites and plain HTML

Covers plain HTML, a build folder from any generator (Vite, Eleventy, Hugo, Jekyll, Gatsby, Docusaurus, VitePress, Next.js `output: 'export'`, `nuxt generate`), and any site you only have a URL for.

```bash
npx renderlint                      # finds dist/, build/, out/, public/… or index.html
npx renderlint dist                 # a build folder (served for you, with SPA fallback)
npx renderlint index.html about.html
npx renderlint https://staging.example.com --max-pages 50
```

- **Pages:**
  - A folder is served as is: every `.html` file in it is checked, and links are followed.
  - A URL (`https://…`, or a server started with `--serve`) is crawled through its links, `sitemap.xml` and `robots.txt`.
- **A base path** (GitHub Pages `/repo/`, Vite `base`): `--base /repo/`.
- **Lots of similar pages** (blog posts, docs) on a URL target: route patterns are inferred from the URLs (`/blog/:slug`), and a few varied instances of each get the full check. See [roles and coverage](../roles-and-coverage.md#hundreds-of-pages). To use that on a build folder, serve it (`--serve "npx serve dist -l 4319" --url http://localhost:4319`).
- **A site behind a login:** see [authentication](../authentication.md). A static site has no server to mock, so use a test account (`auth.login`) or a saved session.

Check staging rather than production when you can. renderlint only loads pages, but it loads every page it finds at several widths.
