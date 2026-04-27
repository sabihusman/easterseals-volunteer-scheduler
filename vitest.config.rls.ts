import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest config for the RLS test harness.
 *
 * Separate from `vitest.config.ts` (the unit + component tests):
 *   - includes only `supabase/test/**\/*.test.ts`
 *   - environment is `node` (no jsdom — these tests talk to a real
 *     Postgres via supabase-js, not to React)
 *   - longer timeouts (DB ops + supabase-js auth round trips are
 *     slower than mocked unit tests)
 *   - globalSetup runs `supabase start` + `db reset` + seeds users
 *     once per invocation (see supabase/test/setup.ts)
 *
 * Run via: `bun run test:rls` (or `npm run test:rls`).
 *
 * The unit-test config (`vitest.config.ts`) restricts include to
 * `src/**\/*.test.{ts,tsx}`, so `supabase/test/**` is already
 * excluded from `npm test` by virtue of its path. No mutual-exclusion
 * fiddling needed.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["supabase/test/**/*.test.ts"],
    globalSetup: ["supabase/test/setup.ts"],
    testTimeout: 30_000, // 30s — covers DB round-trip + auth sign-in latency
    hookTimeout: 60_000, // 60s — covers worst-case `supabase db reset`
    // Pool: forks (default). Threads share globals which doesn't
    // play well with our process.env-based stack-status injection.
    pool: "forks",
    // Limit to 1 worker for the harness — tests share a single DB
    // and parallel workers would race on row creation/cleanup. PR 1
    // tests will use per-test row isolation (random suffixes); even
    // so we keep this conservative until we have evidence parallelism
    // is safe.
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
