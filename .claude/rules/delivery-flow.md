# Delivery flow

Feature work moves through four skills the user types, one stage at a time: `/mattpocock-skills:grill-with-docs` → `/mattpocock-skills:to-spec` → `/mattpocock-skills:to-tickets` → `/mattpocock-skills:implement`. Claude cannot invoke them itself.

- Finish a stage by naming the next command for the user, then stop. Each artifact comes from its own stage: decisions and glossary from grilling, the spec issue from to-spec, ticket issues from to-tickets, code from implement.
- A "check with the user" step inside a skill is a hard stop until the user answers that question.
- Tickets are self-contained: each carries every decision, default and fallback that implement needs, so implement runs end to end without asking. For an unverified risk, the ticket names the fallback to take when the check fails.
- The owner reviews a feature once, after all its tickets are merged. Between tickets, take the next ticket on the frontier without waiting.
- A feature's tests live in one final ticket, blocked by every other ticket of the feature and written after their PRs merge. Feature PRs leave the template's test checkbox unchecked and link that ticket.
