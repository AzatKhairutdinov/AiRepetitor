# Git and pull request workflow

- Never commit or push to `main`; a hook blocks pushes to it and force-pushes. All changes land through a pull request.
- Start from fresh `main`: `git switch main && git pull --ff-only && git switch -c <type>/<short-kebab-name>`.
- Branch types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`. Example: `feat/lesson-endpoint`.
- One concern per branch and per PR. Keep PRs small enough to review in one sitting.
- Before pushing, run `mise run check`. The pre-push hook runs it as well.
- Open the PR with `gh pr create`. Write the body with the `/pr` skill and fill in `.github/PULL_REQUEST_TEMPLATE.md`. Link the issue with `Closes #<n>`.
- Watch CI with `gh pr checks --watch`. When it fails, fix the cause on the same branch.
- Merge with `gh pr merge --auto --squash`. GitHub merges once the required `check` passes. The branch is deleted automatically.
- Leave major dependency bumps for a human to merge.
- Track work in GitHub Issues (see `docs/agents/issue-tracker.md`).
