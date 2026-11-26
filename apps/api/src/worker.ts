// Wrangler entry: the HTTP app plus the Workflow classes. Kept apart from index.ts so tests
// can import the app under Node without `cloudflare:workers`.
import app from "./index.ts";

export { MaterialProcessing } from "./processing/workflow.ts";
export default app;
