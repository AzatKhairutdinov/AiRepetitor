## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (AzatKhairutdinov/AiRepetitor) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Quality gates and generated code

- One check command: `mise run check`. Fix with `mise run fix`. Regenerate contract code with `mise run generate`.
- `libs/contract/**` is generated from `specs/*.tsp`; never hand-edit. See `.claude/rules/`.
- When a check fails, fix the code. Ask a human before disabling a lint rule or loosening a check.
- Scaffold with Nx generators: `pnpm nx g @airepetitor/workspace-plugin:<endpoint|app-api|app-web>`.
- API handlers in `apps/api/src/handlers/` are hand-written; routes, validators and the client are generated.

## Git workflow

Work on a branch `<type>/<short-kebab>` and open a pull request; never push to `main`. See `.claude/rules/git-workflow.md`.

## Security

- `mise run check` scans git history for secrets (Betterleaks). Keep secrets in `.dev.vars` or Wrangler secrets, never in tracked files.
- `mise run security` scans `pnpm-lock.yaml` for known vulnerabilities (OSV). It runs weekly and on lockfile changes in CI.
- Fix a vulnerable dependency by upgrading it or with a pnpm `overrides` entry. Ask a human before ignoring an advisory.
- Code is licensed PolyForm Noncommercial 1.0.0; see `LICENSE`.
