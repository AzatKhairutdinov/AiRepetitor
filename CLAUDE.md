## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (AzatKhairutdinov/AiRepetitor) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Quality gates and generated code

- One check command: `mise run check`. Fix with `mise run fix`. Regenerate contract code with `mise run generate`.
- `libs/contract/**` is generated from `specs/*.tsp`; never hand-edit. See `.claude/rules/`.
- Never disable lint rules or loosen checks without human approval.
