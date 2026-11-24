import { defineConfig } from "orval";

const input = "./openapi/@typespec/openapi3/openapi.yaml";

export default defineConfig({
  server: {
    input,
    output: {
      mode: "split",
      target: "./src/server/api.ts",
      client: "hono",
      clean: false,
      override: {
        // Handlers are hand-written and never overwritten (smart mode keeps bodies).
        hono: { handlers: "../../apps/api/src/handlers" },
      },
    },
  },
  client: {
    input,
    output: {
      mode: "split",
      target: "./src/client/api.ts",
      client: "fetch",
    },
  },
});
