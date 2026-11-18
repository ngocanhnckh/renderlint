# Security policy

## Reporting a vulnerability

If you find a way renderlint could change data in the app it checks, leak a credential, run something it shouldn't, or reach beyond the app under test, please report it privately through [GitHub's private vulnerability reporting](https://github.com/ngocanhnckh/renderlint/security/advisories/new) instead of a public issue. You'll get an answer within a few days.

## Supported versions

Fixes go into the latest release on npm (`@yitec/renderlint`).

## What renderlint does

renderlint runs locally. It has no telemetry and sends nothing to its authors or any third party. It connects only to the app you point it at (and whatever those pages load), to Playwright's download server if Chromium is missing, and to your package registry during `renderlint init`. It runs only your dev server, the package manager during `init`, `playwright install chromium`, and headless Chromium.

The full list, including how it handles sessions, credentials and server-side mocks: [docs/security.md](docs/security.md).
