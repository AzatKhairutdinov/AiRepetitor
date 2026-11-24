import { createFactory } from "hono/factory";
import { zValidator } from "../../../../libs/contract/src/server/api.validator.ts";
import type { HealthContext } from "../../../../libs/contract/src/server/api.context.ts";
import { HealthResponse } from "../../../../libs/contract/src/server/api.zod.ts";

const factory = createFactory();
export const healthHandlers = factory.createHandlers(
  zValidator("response", HealthResponse),
  async (c: HealthContext) => c.json({ status: "ok" as const }, 200),
);
