---
name: prove-gate
description: Prove a quality gate really fails. Use after adding or changing a lint rule, hook, or CI check.
---

1. Create a scratch branch.
2. Introduce a real violation the gate should catch (bad markdown, typo, type error, stale generated file, ...).
3. Run `mise run check`; confirm a non-zero exit and that the right step reported it.
4. Revert the violation and delete the scratch branch.
5. Report which gate was proven.
