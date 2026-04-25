# Onboarding

This is the day-one setup guide for a new contributor. Read [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) first if you want context on how the pieces fit together.

## Prerequisites

- **Node.js 22+** — CI runs on `actions/setup-node@v6` with `node-version: 22`. Node 20 will probably work locally but isn't tested.
- **Bun** — `bun.lock` is the source of truth for dependency resolution. Install via `npm i -g bun` or [bun.sh](https://bun.sh/). `npm install` works as a fallback but you'll diverge from CI's lockfile.
- **Supabase CLI** — `npm i -g supabase`. Required because `npm run prebuild` runs `supabase gen types typescript --linked` to regenerate [`src/integrations/supabase/types.ts`](../src/integrations/supabase/types.ts) from the live schema. If you skip the CLI install, `bun run build` will fail.
- **GitHub account with read access** to [`sabihusman/easterseals-volunteer-scheduler`](https://github.com/sabihusman/easterseals-volunteer-scheduler), and write access if you're contributing.
- **Supabase account** with at least read access to the production project (`esycmohgumryeqteiwla`). Ask the tech owner for an invite. If you'd rather work against a personal project, you'll need to apply all migrations under `supabase/migrations/` — see [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md#applying-a-database-migration).
- **VS Code suggested** — extensions: ESLint, Prettier, Tailwind CSS IntelliSense, the Supabase extension if you do schema work. Other editors fine; the repo doesn't ship `.vscode/` settings.
- **Git** with your name and email configured globally.

## Cloning and installing

```bash
git clone https://github.com/sabihusman/easterseals-volunteer-scheduler.git
cd easterseals-volunteer-scheduler

bun install   # or: npm install
```

Bun installs ~700 dependencies in a few seconds. If you see lockfile-related warnings on `npm install`, that's expected — `bun.lock` is the canonical lockfile.

## Setting up `.env.local`

```bash
cp .env.example .env.local
```

Open [`.env.example`](../.env.example) — every variable is grouped by scope:

- `[frontend]` — read by Vite at build time, **inlined into the browser bundle**. Never put secrets here. The `VITE_*` prefix is what makes them visible to client code.
- `[edge]` — read by Supabase edge functions at runtime via `Deno.env.get(...)`. In production these are set with `supabase secrets set ...`. In local dev they only matter if you're running edge functions with `supabase functions serve`.
- `[ci]` — only used by GitHub Actions; never set locally.
- `[dashboard]` — configured directly in the Supabase project dashboard (e.g. the Turnstile secret key).

**For day-one local dev you only need:**

- `VITE_SUPABASE_URL` — `https://esycmohgumryeqteiwla.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` — the anon (publishable) key from the Supabase dashboard → Settings → API. Never the service-role key. The publishable key is safe in browser bundles by design — RLS does the auth.

Optional but recommended:

- `VITE_SENTRY_DSN` — paste it to send errors to Sentry; leave empty to disable.
- `VITE_TURNSTILE_SITE_KEY` — needed if you want to test signup/signin locally; otherwise the captcha widget shows an error.

## Running the dev server

```bash
bun run dev
```

Vite serves on `http://localhost:8080` (port set in [vite.config.ts](../vite.config.ts)). Hot module reload works for React component edits; route changes need a manual refresh.

A few things to know:

- The first run will be slow because `prebuild` regenerates types. After that, `bun run dev` skips `prebuild` (only `bun run build` triggers it).
- If you see `Missing Supabase environment variables`, you forgot to fill `.env.local`. The error is thrown intentionally in [`src/integrations/supabase/client.ts`](../src/integrations/supabase/client.ts) — silent fallback would let the app boot with a broken backend.
- Vercel Analytics fires events even in dev, but Sentry is gated on `import.meta.env.PROD` so dev errors don't pollute the project.

## Running tests

```bash
# Unit + integration tests (Vitest)
bun run test            # one-shot
bun run test:watch      # interactive

# Type check (matches CI)
bun run typecheck       # tsc --build

# Lint (matches CI)
bun run lint            # eslint . --max-warnings=100

# E2E (Playwright)
bun run test:e2e        # runs against PLAYWRIGHT_BASE_URL or production by default
bun run test:e2e:ui     # Playwright's interactive UI
```

**Vitest scope:** Unit and integration tests live under `src/lib/__tests__/` and `src/hooks/__tests__/`. Pages and components mostly aren't unit-tested; we lean on Playwright for end-to-end behavior. See [DECISION_LOG.md § Test concentration](./DECISION_LOG.md#test-concentration-in-srclib-not-pages) for the rationale.

**Playwright caveat:** by default the E2E suite hits the production URL (`https://easterseals-volunteer-scheduler.vercel.app`) using test-tagged accounts. To run against your local dev server:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:8080 bun run test:e2e
```

You'll also need to set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `TEST_VOLUNTEER_EMAIL` / `TEST_COORDINATOR_EMAIL` / `TEST_ADMIN_EMAIL` / `TEST_PASSWORD` in your environment — these aren't in `.env.example` because they're CI secrets.

## First PR workflow

1. **Branch from main:**
   ```bash
   git checkout main && git pull
   git checkout -b feature/short-description
   ```
   Branch prefixes: `feature/*` for new functionality, `fix/*` for bug fixes, `chore/*` for tooling/docs/deps, `hotfix/*` for emergency prod patches. **Never push directly to main** — branch protection rejects it.

2. **Make your change.** Run `bun run lint` and `bun run typecheck` locally before committing — CI runs them and you'll save a round-trip.

3. **Commit.** Conventional-ish style: `feat(area): summary`, `fix(area): summary`, `chore(area): summary`, `docs(area): summary`. The body should explain *why*, not what (the diff already shows what). End every commit with the `Co-Authored-By` trailer if AI-assisted.

4. **Push and open a PR.**
   ```bash
   git push -u origin feature/short-description
   gh pr create --title "..." --body "..."
   ```
   PR description should have `## Summary` (1–3 bullets) and `## Test plan` (checklist).

5. **CI runs three jobs**:
   - `Lint + Vitest unit tests` (≈2 min) — required for merge
   - `Playwright E2E` (≈3–5 min) — runs against prod, gated behind `github.actor != 'dependabot[bot]'`
   - `Comment test results on PR` — posts both outputs in a single comment

6. **Branch protection** on main requires `Lint + Vitest unit tests` to pass and at least one approving review. The `Playwright E2E` check is informational; some Dependabot PRs run without it because Dependabot can't access E2E secrets unless you duplicate them into the Dependabot secret namespace.

7. **Merge.** Squash-merge is the project default — keeps `main`'s history linear. Delete the branch after merging.

## Common gotchas

**1. Auth callbacks deadlock if you `await` inside them.** The Supabase JS client holds the GoTrue auth lock during `onAuthStateChange` callbacks; awaiting any Supabase query inside the callback causes the app to hang on signin. Always defer DB reads with `setTimeout(..., 0)`. See [AuthContext.tsx](../src/contexts/AuthContext.tsx) for the pattern.

**2. `types.ts` regeneration on Windows can corrupt the file.** Don't run `supabase gen types typescript --linked > src/integrations/supabase/types.ts` from PowerShell — it writes UTF-16 with a BOM, which TypeScript can't parse. Use the committed [`scripts/gen-types.mjs`](../scripts/gen-types.mjs) Node script which forces UTF-8.

**3. PostgREST embedded joins are LEFT JOINs by default.** A query like `.select("id, profiles(full_name)")` returns the row even if the joined profile is null. Use `!inner` (e.g. `profiles!inner(full_name)`) to opt into inner-join semantics. We hit this when designing `DepartmentVolunteersTab` — orphan bookings (`volunteer_id IS NULL`) survived the LEFT JOIN and had to be filtered client-side.

**4. RLS on `department_coordinators` returns all rows for any coordinator.** The policy checks `is_coordinator_or_admin()`, not "is *this* coordinator". So queries against this table need `coordinator_id=eq.<auth.uid()>` to filter to the caller. Easy to miss; produces "why is this coordinator seeing other departments' assignments?" bugs.

**5. The `(supabase as any).rpc(...)` pattern.** Some RPCs (waitlist_accept, MFA recovery, calendar feed) aren't covered by the type generator. Casting to `any` is the canonical workaround documented in [eslint.config.js](../eslint.config.js); `@typescript-eslint/no-explicit-any` is intentionally off.

**6. `--max-warnings=100` masks new warnings.** The lint ceiling means CI won't fail until the warning count crosses 100. Sprint 2 Phase 2 introduces a follow-up to tighten this to 0; until then, treat new warnings as bugs even if CI is green.

**7. Migrations are forward-only.** Don't try to write a "rollback" SQL file — Supabase doesn't replay a `down` migration. To undo, write a new forward migration that reverses the change. See [OPERATIONS_RUNBOOK.md § Applying a migration](./OPERATIONS_RUNBOOK.md#applying-a-database-migration).

**8. Edge functions run Deno, not Node.** No `process.env`; use `Deno.env.get(...)`. URL imports work (e.g. `import { createClient } from "https://esm.sh/@supabase/supabase-js@2"`). Ed25519/JWT helpers are `https://deno.land/x/...`. They are linted with their own ESLint block (see [eslint.config.js](../eslint.config.js)) using `globals.denoBuiltin`.

**9. `bun run` vs `npm run` matters.** Bun's package runner skips lifecycle hooks differently than npm in some cases. CI uses bun; if a script "works locally on npm but fails on CI," check whether it relies on a `pre*`/`post*` hook order.

**10. Branch protection requires the check name to match exactly.** The CI job displays as "Lint + Vitest unit tests" even though it now also runs `tsc --build`. Renaming the job display name without updating branch-protection settings will break merges. There's a comment in [ci.yml](../.github/workflows/ci.yml) explaining this — read it before renaming.

For deploy, rollback, secret rotation, and incident response, see [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).
