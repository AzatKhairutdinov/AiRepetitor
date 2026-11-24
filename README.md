# AiRepetitor

A TypeSpec-first TypeScript web app. See `docs/adr/` for the decisions behind the stack.

Licensed under PolyForm Noncommercial 1.0.0 (see `LICENSE`).

## Quickstart

Prerequisite: [mise](https://mise.jdx.dev). Everything else is pinned in `mise.toml`.

```sh
mise install        # pinned tools
mise run setup      # dependencies and git hooks
mise run dev        # API on :8787, web on :5173 (creates .dev.vars and local D1 first)
```

## Everyday commands

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `mise run check`       | Every gate CI runs (lint, types, tests, builds, security) |
| `mise run fix`         | Apply autofixes                                           |
| `mise run generate`    | Regenerate `libs/contract` from `specs/*.tsp`             |
| `mise run db:generate` | New SQL migration from `apps/api/src/db/schema.ts`        |
| `mise run db:reset`    | Wipe and re-create the local database                     |
| `mise run security`    | Scan the lockfile for known vulnerabilities               |

## Layout

- `specs/` TypeSpec, the source of every API type
- `libs/contract/` generated routes, validators and client (never hand-edit)
- `apps/api/` Hono on Cloudflare Workers, Better Auth, Drizzle on D1
- `apps/web/` React and Vite
- `tools/workspace-plugin/` Nx generators (`endpoint`, `app-api`, `app-web`)

Work happens on branches and pull requests; see `.claude/rules/git-workflow.md`.
