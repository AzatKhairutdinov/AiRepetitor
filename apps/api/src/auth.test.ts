import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "./index.ts";
import type { Env } from "./env.ts";

// Generated per run so no secret-looking literals live in the repo.
const randomValue = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;

let env: Pick<Env, "DB" | "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL">;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const proxy = await getPlatformProxy<Pick<Env, "DB">>({
    configPath: join(import.meta.dirname, "../wrangler.toml"),
    persist: false,
  });
  dispose = proxy.dispose;

  // Apply the real migrations to the throwaway local D1.
  const dir = join(import.meta.dirname, "../migrations");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const statements = readFileSync(join(dir, file), "utf-8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await proxy.env.DB.prepare(statement).run();
    }
  }

  env = {
    DB: proxy.env.DB,
    BETTER_AUTH_SECRET: randomValue(),
    BETTER_AUTH_URL: "http://localhost",
  };
});

afterAll(async () => {
  await dispose();
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://localhost" },
  body: JSON.stringify(body),
});

describe("auth", () => {
  const credentials = {
    email: "student@example.com",
    password: randomValue(),
    name: "Student",
  };

  it("signs up, signs in and returns the session", async () => {
    const signUp = await app.request("/api/auth/sign-up/email", json(credentials), env);
    expect(signUp.status).toBe(200);

    const signIn = await app.request(
      "/api/auth/sign-in/email",
      json({ email: credentials.email, password: credentials.password }),
      env,
    );
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");

    const session = await app.request("/api/auth/get-session", { headers: { cookie } }, env);
    const body = (await session.json()) as { user: { email: string } };
    expect(body.user.email).toBe(credentials.email);
  });

  it("rejects a wrong password", async () => {
    const res = await app.request(
      "/api/auth/sign-in/email",
      json({ email: credentials.email, password: randomValue() }),
      env,
    );
    expect(res.status).toBe(401);
  });
});
