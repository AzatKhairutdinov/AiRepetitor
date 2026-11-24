import { defineConfig } from "orval";

export default defineConfig({
  server: {
    input: "./openapi/@typespec/openapi3/openapi.yaml",
    output: {
      mode: "split",
      target: "./src/server",
      client: "hono",
    },
  },
  client: {
    input: "./openapi/@typespec/openapi3/openapi.yaml",
    output: {
      mode: "split",
      target: "./src/client",
      client: "fetch",
    },
  },
});
