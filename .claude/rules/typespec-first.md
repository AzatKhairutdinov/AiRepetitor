# TypeSpec is the source of every type

- API request/response types live in `specs/` only. Do not write a parallel hand-made interface, zod schema or DTO for something TypeSpec already models.
- Import types from `libs/contract`.
- Exception: the database schema (`apps/api/src/db/schema.ts`, Drizzle) is hand-written, since no mature TypeSpec-to-DB emitter exists. Keep it mapped to contract types at the boundary.
