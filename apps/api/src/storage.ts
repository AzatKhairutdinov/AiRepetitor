// File storage port: the rest of the code only sees "a link to write" and "a link to read".
// Prod: R2 S3 API presigned links. Local (default): links to this API's /storage route,
// signed with an HMAC and an expiry, which reads and writes through the R2 binding.
import { AwsClient } from "aws4fetch";
import { Hono } from "hono";
import type { Env } from "./env.ts";

interface WriteLink {
  url: string;
  /** Headers the PUT must carry. */
  headers: Record<string, string>;
}

export interface Storage {
  writeLink(key: string, contentType: string, ttlSeconds: number): Promise<WriteLink>;
  readLink(key: string, ttlSeconds: number): Promise<string>;
}

const DEFAULT_BUCKET = "airepetitor-files";

/** Picks R2 presigned links when the S3 secrets are set, local signed links otherwise. */
export function storageFor(env: Env, origin: string): Storage {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return r2Storage(
      R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      env.R2_BUCKET ?? DEFAULT_BUCKET,
    );
  }
  return localSignedStorage(env.BETTER_AUTH_SECRET, origin);
}

function r2Storage(
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
): Storage {
  const client = new AwsClient({ service: "s3", region: "auto", accessKeyId, secretAccessKey });
  const objectUrl = (key: string, ttl: number) =>
    `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}?X-Amz-Expires=${ttl}`;
  return {
    async writeLink(key, contentType, ttl) {
      const headers = { "content-type": contentType };
      const signed = await client.sign(
        new Request(objectUrl(key, ttl), { method: "PUT", headers }),
        {
          aws: { signQuery: true, allHeaders: true },
        },
      );
      return { url: signed.url.toString(), headers };
    },
    async readLink(key, ttl) {
      const signed = await client.sign(new Request(objectUrl(key, ttl)), {
        aws: { signQuery: true },
      });
      return signed.url.toString();
    },
  };
}

// --- Local signed links ------------------------------------------------------

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`storage:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return btoa(String.fromCharCode(...mac))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

const payload = (method: string, key: string, expires: number) => `${method}\n${key}\n${expires}`;

function localSignedStorage(secret: string, origin: string): Storage {
  const link = async (method: "GET" | "PUT", key: string, ttl: number) => {
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const sig = await hmac(secret, payload(method, key, expires));
    return `${origin}/storage/${key}?expires=${expires}&sig=${sig}`;
  };
  return {
    async writeLink(key, contentType, ttl) {
      return { url: await link("PUT", key, ttl), headers: { "content-type": contentType } };
    },
    readLink: (key, ttl) => link("GET", key, ttl),
  };
}

/** Constant-time comparison of two strings. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** R2 needs a body of known length: workerd's FixedLengthStream, or a buffer under Node tests. */
async function knownLengthBody(request: Request, length: number) {
  if (typeof FixedLengthStream === "undefined") return request.arrayBuffer();
  const fixed = new FixedLengthStream(length);
  void request.body!.pipeTo(fixed.writable);
  return fixed.readable;
}

/**
 * The local stand-in for R2's presigned links. Not part of the product API (no TypeSpec):
 * it carries raw file bytes and mirrors what R2 does for a presigned PUT or GET.
 */
export const localStorageRoutes = new Hono<{ Bindings: Env }>();

localStorageRoutes.on(["GET", "PUT"], "/storage/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const expires = Number(c.req.query("expires"));
  const sig = c.req.query("sig") ?? "";
  const method = c.req.method as "GET" | "PUT";
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return c.text("Link expired", 403);
  if (!sameText(sig, await hmac(c.env.BETTER_AUTH_SECRET, payload(method, key, expires)))) {
    return c.text("Bad signature", 403);
  }
  if (method === "PUT") {
    const length = Number(c.req.header("content-length"));
    if (!c.req.raw.body || !Number.isFinite(length)) return c.text("Content-Length required", 411);
    await c.env.FILES.put(key, await knownLengthBody(c.req.raw, length), {
      httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
    });
    return c.body(null, 200);
  }
  const object = await c.env.FILES.get(key);
  if (!object) return c.text("Not found", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
});
