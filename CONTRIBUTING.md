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
