# Contributing

## Branch Naming Convention

All work should be done in feature branches. **Never commit directly to `main`.**

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/group-bookings` |
| `fix/` | Bug fixes | `fix/slot-count-decrement` |
| `chore/` | Maintenance, refactors, CI | `chore/update-dependencies` |

## Workflow

1. Create a branch from `main` using the naming convention above.
2. Make your changes with clear, focused commits.
3. Open a Pull Request against `main`.
4. Ensure CI passes (lint + tests).
5. Request review and address feedback.
6. Squash-merge into `main`.

## Running Tests

### Unit + component tests (mocked Supabase)

```bash
npx vitest          # watch mode
npx vitest run      # single run
npx vitest run --coverage  # with coverage
```

These cover `src/**/*.{test,spec}.{ts,tsx}` and use a mocked Supabase client. Fast, no external dependencies.

### RLS integration tests (real Supabase stack)

The RLS test harness runs Vitest against a local Supabase stack (Postgres + Auth + Storage + RLS), so policy logic and trigger behavior can be exercised end-to-end.

**Prerequisites:**
- Docker Desktop running
- Supabase CLI installed (`scoop install supabase` on Windows, `brew install supabase/tap/supabase` on macOS, or [other install paths](https://supabase.com/docs/guides/cli/getting-started))

**Run the harness:**

```bash
npm run test:rls
```

First invocation cold-starts the Supabase Docker stack (2–5 min while images pull). Subsequent invocations reuse the running stack and only re-apply migrations + reseed (~10 seconds).

**Conventions for harness tests:**

- Live in `supabase/test/**/*.test.ts` (separate from unit tests in `src/**`)
- One Vitest invocation = one `supabase db reset` + one fixtures application + one user-seeding pass via `supabase/test/setup.ts`
- Each test file's `beforeAll` may reset DB + reseed; each test owns its own row creation; `afterEach` cleans up rows in FK dependency order; `afterAll` resets DB for cleanliness across files
- Per-test isolation via random suffixes on usernames / email locals — avoid hardcoding values another test might also create
- Import role-scoped clients from `supabase/test/clients.ts`:
  - `await signInAs("volunteer" | "volunteer2" | "coordinator" | "admin")` for an authenticated client
  - `anonClient()` for an unauthenticated client
  - `adminBypassClient()` (service role, bypasses RLS) — for staging rows in test setup ONLY, never in the assertion path

**Stopping the stack:**

```bash
supabase stop
```

Optional — the stack is harmless to leave running. Each `npm run test:rls` resets DB state on the existing stack.

**CI behavior:** the `RLS integration tests` job runs in parallel with `Playwright E2E` after `Lint + Vitest unit tests` passes. Skips on Dependabot PRs.

## Linting

```bash
npx eslint .
```

## Code Style

- Use TypeScript strict mode.
- Follow existing patterns in the codebase.
- Use Tailwind semantic tokens — never hardcode colors in components.
- Keep components small and focused.

## Writing Supabase Migrations

### `CREATE TABLE` — always include explicit grants

Supabase changed default Data API grants on new public-schema tables effective **2026-10-30**. Tables created after that date on existing projects are NOT reachable via `supabase-js` / PostgREST unless the migration grants explicit table-level privileges. (Tables created before the cutoff are grandfathered; this rule is forward-looking.)

Every `CREATE TABLE public.<name>` migration **must** include the following block, customized for the table:

```sql
CREATE TABLE public.<name> ( ... );

-- Data API grants (required for Supabase Data API / supabase-js access).
-- See https://supabase.com/blog/changes-to-data-api-grants-october-2026
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<name> TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<name> TO service_role;
-- Uncomment ONLY if anonymous read access is intentionally required
-- (e.g., kiosk flows, public sign-up surfaces):
-- GRANT SELECT ON public.<name> TO anon;
```

RLS policies are still required for row-level authz — table-level grants are necessary but not sufficient. If the table has no RLS, anon would be able to read all rows; if RLS denies all, the table is unusable even with the grants. Both must be in place.

### `CREATE OR REPLACE FUNCTION` — always re-pin `SET search_path`

`CREATE OR REPLACE FUNCTION` replaces the entire function definition, **including any prior function-level `SET` clauses**. If you rewrite a `SECURITY DEFINER` function (or any trigger function in the public schema) and omit `SET search_path`, you silently drop the pinning that the April 2026 hardening sweep added — Supabase's Security Advisor will flag `function_search_path_mutable` on the next scan.

Whenever you `CREATE OR REPLACE` a SECURITY DEFINER function or a trigger function, include:

```sql
CREATE OR REPLACE FUNCTION public.my_function(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog   -- ← do not omit this line
AS $$
...
$$;
```

The Phase 2 lockdown migration `20260513120000_security_definer_lockdown.sql` documents seven functions that regressed this way. Don't add an eighth.

### SECURITY DEFINER function grants

After the Phase 2 lockdown (PR following #194), every SECURITY DEFINER function in `public` either:

- Has its EXECUTE grant revoked from `PUBLIC, anon, authenticated` (triggers, cron callbacks, internal helpers), OR
- Has it revoked from `PUBLIC, anon` and granted to `authenticated` (admin RPCs, frontend-only RPCs), OR
- Is on the **Bucket B intentional-exposure list** below.

When you add a new SECURITY DEFINER function, write the appropriate grant block as part of the same migration:

```sql
CREATE OR REPLACE FUNCTION public.new_admin_rpc(...) ... SECURITY DEFINER ...;

-- Default tightening for a SECURITY DEFINER function. Pick ONE pattern:

-- Pattern A: trigger function / cron callback / internal helper
REVOKE EXECUTE ON FUNCTION public.new_admin_rpc(...) FROM PUBLIC, anon, authenticated;

-- Pattern B: authenticated-only RPC (frontend caller after sign-in)
REVOKE EXECUTE ON FUNCTION public.new_admin_rpc(...) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.new_admin_rpc(...) TO authenticated;

-- Pattern C: anon-callable (sign-up, kiosk, etc.) — REQUIRES JUSTIFICATION
-- in a comment in the migration AND an entry added to the Bucket B
-- table in CONTRIBUTING.md.
```

> **⚠️ Before revoking EXECUTE from `authenticated` on ANY function, check
> whether an invoker-context (non-`SECURITY DEFINER`) trigger calls it.**
> If so, `authenticated` MUST keep EXECUTE — a `SECURITY INVOKER` trigger
> runs as the user who fired it, so when an authenticated user's
> INSERT/UPDATE/DELETE fires the trigger, the trigger's call to the helper
> is checked against *that user's* grants. Revoking it makes the whole
> operation fail with `42501 permission denied for function ...`.
>
> This is exactly how PR #196 broke `promote_next_waitlist` in production:
> it's called by `trg_waitlist_promote_on_cancel` / `trg_waitlist_promote_on_delete`
> (both `LANGUAGE plpgsql`, no `SECURITY DEFINER`), so revoking it from
> `authenticated` made every booking cancellation / shift deletion 403.
> Fixed in `20260613000000_grant_promote_next_waitlist_to_authenticated.sql`.
>
> Quick check before a REVOKE: `grep` the function name across migrations
> for `PERFORM`/`SELECT` callers, and for each caller confirm it's either
> `SECURITY DEFINER` (safe — runs as owner) or pg_cron-only (safe). If a
> plain `LANGUAGE plpgsql` trigger function calls it, use Pattern B
> (keep `authenticated`), not Pattern A.

### Bucket B — intentional anon/authenticated exposure (do not lock down)

These SECURITY DEFINER functions are deliberately callable by `anon` and/or `authenticated`. Supabase Security Advisor will flag them on every scan; the rationale below is the answer.

| function | callable by | why |
|---|---|---|
| `is_admin()` | authenticated | RLS predicate invoked per-row in dozens of policies. Locking down breaks RLS. |
| `is_coordinator_or_admin()` | authenticated | Same — RLS predicate. |
| `is_coordinator_for_my_dept(uuid)` | authenticated | RLS predicate for departmental scoping. |
| `my_role()` | authenticated | RLS predicate + frontend role gating. |
| `has_active_booking_on(uuid)` | authenticated | RLS predicate used in `shift_bookings` policies. |
| `is_current_user_minor()` | authenticated | RLS predicate for minor-consent gating. |
| `username_available(text)` | anon, authenticated | Sign-up flow needs to check username availability before the user has a JWT. |
| `get_email_by_username(text)` | anon, authenticated | Sign-in flow accepts username OR email; the username→email lookup happens pre-auth. |
| `notification_link_booking_id(text)` | authenticated | STABLE helper used in `notifications` views/RLS — a per-row evaluator, not an RPC. |
| `validate_checkin_token(text)` | anon | Kiosk check-in flow uses the project anon key; the function only validates the token and returns a boolean. |

If you're adding a function to this list, you need a security review comment in the PR and a one-line justification in the table above.

## Dependency Updates (Dependabot + bun)

This repo uses **bun**, and CI/deploy run `bun install --frozen-lockfile` against **`bun.lock`** (the single source of truth — `package-lock.json` was removed in #205). Dependabot **cannot maintain `bun.lock`**: it only bumps `package.json`, which then fails the frozen-lockfile check. Because of that, and because unreviewed dependency churn is what caused the 2026-06 lockfile-drift incident (#203/#204), **routine version updates are deliberate, not automated.**

What's configured:
- **Routine version PRs are silenced** — `open-pull-requests-limit: 0` on both Dependabot ecosystems. Dependabot will not open version-bump PRs.
- **Security stays on** — Dependabot **alerts** and **security updates** remain enabled (repo Settings → Code security). `open-pull-requests-limit: 0` does not affect them (separate internal limit), and the wildcard `version-update:semver-major` ignore does not affect them either (`update-types` applies to version updates only). A real vulnerability still surfaces.
  - Caveat: a Dependabot *security-update PR* hits the same `bun.lock` limitation, so it too needs a manual `bun install` to pass CI — but the **alert** fires reliably, and a real vuln warrants a deliberate manual fix anyway.

**To take a dependency update (routine or security):**
```bash
# Edit the version in package.json (or check out the Dependabot branch), then:
bun install            # regenerates bun.lock to match
git add package.json bun.lock
git commit -m "chore(deps): bump <pkg> to <version>"
# The frozen-lockfile check now passes.
```
Major bumps are additionally held by the wildcard `semver-major` ignore in `.github/dependabot.yml` — they're deliberate, coordinated upgrades (remove the ignore or bump by hand when ready).
