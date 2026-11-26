// Wrangler entry: the HTTP app, the daily Cron Trigger and the Workflow classes. Kept apart from
// index.ts so tests can import the app under Node without `cloudflare:workers`.
import type { Env } from "./env.ts";
import app from "./index.ts";
import { purgeOriginals } from "./processing/retention.ts";

export { MaterialProcessing } from "./processing/workflow.ts";

export default {
  fetch: app.fetch,
  /** Daily: originals of Sources processed more than 7 days ago. */
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      purgeOriginals(env).then(
        (count) => console.log("Expired originals deleted", count),
        (error) => console.error("Could not delete expired originals", error),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
