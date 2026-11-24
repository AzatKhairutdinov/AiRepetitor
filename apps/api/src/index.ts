import routes from "@airepetitor/contract/server";
import { Hono } from "hono";
import { createAuth } from "./auth.ts";
import type { Env } from "./env.ts";

const app = new Hono<{ Bindings: Env }>();

// Better Auth owns /api/auth/* (not described in TypeSpec; see ADR 0002).
app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));
app.route("/", routes);

export default app;
