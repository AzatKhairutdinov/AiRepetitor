# Quality gates

- The one check command is `mise run check` (same set CI runs). Run it before finishing; a Stop hook runs it too.
- `mise run fix` applies autofixes.
- Never disable a lint rule, loosen a check, skip a hook or add a suppression without human approval. Exceptions must be narrow, justified, and carry a review date.
- Never turn a failing check into a warning to make it pass.
