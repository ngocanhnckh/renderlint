# Storybook

Stories render components with mocked data in every state, with no backend and no login. That makes them a quick way to check components in isolation, including states that are hard to reach in the app.

```bash
npx storybook build && npx renderlint storybook            # storybook-static/
npx renderlint storybook http://localhost:6006              # a running Storybook
npx renderlint storybook --globals theme:dark --stories "button--*,Forms/*"
```

The same options can go in the config:

```json
{ "storybook": { "globals": ["theme:dark"], "stories": ["Forms/*"] } }
```

## What gets checked

- **Every story in Storybook's `index.json`** (Storybook 7 and later) is checked as a page of its own (`iframe.html?id=…&viewMode=story`), with the data, mocks, loaders and play functions the story sets up.
- **Play functions run first.** renderlint waits for the play function to finish, so a menu it opens is what gets checked.
- **Skipped:** docs entries, and stories tagged `skip-renderlint`.
- **`--globals k:v`** checks every story again with those globals (themes, locales). It can be repeated.
- **A story that throws** is reported with its error.
- **Component stories** (layout `padded` or `centered`) are a component alone on an empty canvas, so the page-level rules (`viewport-overflow`, `accidental-scrollbar`) only apply to `fullscreen` stories.

## Tips

- Add stories with worst-case args: a long name, a 60-character email, an empty list, an error state. Each one is checked like a page.
- Stories complement the app run; they don't replace it. Layout bugs often come from how components are combined on a page.

## Tested with

Storybook 9.1 (Vite builder), built to `storybook-static/`. The `index.json` format is the same in Storybook 7 to 10, but only 9 was run.
