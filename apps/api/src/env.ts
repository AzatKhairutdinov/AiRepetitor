export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Processing of one Material (Cloudflare Workflow, class MaterialProcessing). */
  PROCESSING: Workflow<{ materialId: string }>;
  /** Shared secret of the extraction worker. */
  WORKER_TOKEN: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  /** R2 S3 API credentials. When all are set, links point at R2 directly; otherwise at the local storage route. */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Bucket for the S3 API links; defaults to the bucket bound as FILES in wrangler.toml. */
  R2_BUCKET?: string;
}
