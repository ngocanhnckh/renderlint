# Coding agents

renderlint is built to be run by coding agents (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf, Aider, Amp, Zed…) after every UI change. `renderlint init` sets that up.

## What `init` installs

- **`AGENTS.md`:** a "UI quality gate: renderlint" section. It tells the agent to run `npx renderlint` after UI changes, fix every error, never hide symptoms, and read the matching skill before setup or fix work. `CLAUDE.md` imports `AGENTS.md`. Re-running `init` updates the section in place.
- **Skills in `.claude/skills/`:** Claude Code loads them as skills. They are plain Markdown, so any other agent reads them too, through the paths listed in `AGENTS.md`.

  | Skill | Use it for |
  |---|---|
  | `renderlint-setup` | Making renderlint check every page: finding how the app signs in and where roles come from, writing `roles`, `mock` and fixtures with worst-case data, `params` for dynamic routes, and closing every gap in the coverage report. Frontend only, credentials only through `${ENV}`. |
  | `renderlint-fix` | Fixing findings at the root, rule by rule. Handling `auth-required`, `page-not-shown` and coverage gaps properly, and marking intentional cases with a reason. |
  | `renderlint-e2e` | Adding the Playwright fixture and reporter, checking Storybook stories, reusing MSW handlers or HAR recordings. |

  The sources are in [`skills/`](../skills).
- **A Claude Code Stop hook** (`.claude/settings.json`). When Claude is about to finish a turn in which UI files changed, the hook runs renderlint on the routes the edit affects. If errors remain, the report goes back to Claude and it keeps working. It never blocks more than 4 times in a row.

## Updating the skills

Each installed `SKILL.md` ends with a marker line holding the version and a hash of its content. Running `init` again:

- installs skills that are missing;
- updates skills that are unchanged since they were installed and have a newer version;
- **leaves skills you edited alone,** and says so (`--force` replaces them).

`--no-skills` skips them. `AGENTS.md` then points at the copies inside the installed package (`node_modules/@yitec/renderlint/skills/`).

## Agents that read other files

If your agent reads `.cursorrules`, `.github/copilot-instructions.md` or `GEMINI.md` instead of `AGENTS.md`, copy the section there, or add a line that points to `AGENTS.md`.

## Prompt

To set renderlint up through your agent, paste:

> Set up renderlint in this project: run `npx -y @yitec/renderlint init`, then follow the "UI quality gate: renderlint" section it adds to AGENTS.md. Use the renderlint-setup skill until the coverage report shows every route checked, then fix every error until `npx renderlint` shows 0 errors.
