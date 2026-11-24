---
paths: ["libs/contract/**", "specs/**"]
---

# Generated files

- `libs/contract/**` is generated from `specs/*.tsp`. Never hand-edit it; a hook blocks edits.
- To change an API shape: edit `specs/*.tsp`, run `mise run generate`, commit the regenerated output.
- CI regenerates and fails on any diff (`scripts/gen-check.sh`).
