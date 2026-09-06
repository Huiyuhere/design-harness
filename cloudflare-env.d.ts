// Logical bindings only. Values and credentials are supplied by Sites.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ARTIFACTS: R2Bucket;
    ASSETS: Fetcher;
  }
}
