# Decision Log

Architectural decisions and the reasoning behind them. Each entry: date, decision, context, alternatives, consequences. Newest at top.

---

## Cron jobs currently live only in the Supabase dashboard

**Date:** 2026-04-24 (documented; the situation predates this entry by months)
**Decision:** Until [issue #116](https://github.com/sabihusman/easterseals-volunteer-scheduler/issues/116) lands, 14 of the 15 pg_cron jobs live only in the Supabase project dashboard.
**Context:** Most cron jobs were created interactively in the SQL editor while the corresponding edge function or DB function was being iterated. The lifecycle migration (`20260415000000_shift_lifecycle_rules.sql`) added `cron.schedule` for `shift-status-transition` because that one was developed alongside its enforcement triggers; the other 14 were never folded back into migrations.
**Alternatives considered:**
- Export now in this Sprint 2 Phase 3 PR: rejected — adds scope to a documentation PR and risks introducing schema-modifying SQL alongside docs.
- Leave undocumented: rejected — defeats the purpose of the handoff package.
**Consequences:** A fresh Supabase project (staging, recovery) won't recreate the schedule automatically. Until #116 ships, treat the dashboard as the source of truth and run the export query in [OPERATIONS_RUNBOOK.md § Cron jobs](./OPERATIONS_RUNBOOK.md#cron-jobs) to dump current state before destructive changes.

---

## Strict TypeScript and `--max-warnings=0` enforced in CI

**Date:** 2026-04-24 (`--max-warnings=0` arrived in Sprint 2 Phase 2; strict mode in Sprint 2 Phase 1, PR #99)
**Decision:** Run `tsc --build` with full strict mode in CI. Cap ESLint at zero warnings.
**Context:** Pre-Sprint-2, `npm run build` was just `vite build` — no type-check. Type errors accumulated silently because Vite's transpile-only build doesn't surface them. Sprint 2 Phase 1 (PR #99) added `bun run typecheck` to CI; Phase 2 dropped the warning ceiling to zero.
**Alternatives considered:**
- Skip the typecheck (status quo before Phase 1): rejected — three real bugs were already hiding behind it (filed as issues #94–#98 during the audit).
- Soft warning ceiling at 100: kept temporarily through Phase 1, removed in Phase 2 because it masked new warnings.
- Enable `@typescript-eslint/no-explicit-any`: rejected — `(supabase as any).rpc()` is canonical for RPCs the type generator doesn't cover, and broadening would require suppression at every call site. See the comment in [eslint.config.js](../eslint.config.js).
**Consequences:** New type errors break CI immediately, surfacing problems while they're fresh. Three breaking dep majors (`recharts`, `react-day-picker`, `react-resizable-panels`) had to be rolled back and added to the Dependabot ignore list once strict mode caught them.

---

## ESLint 10 + react-hooks v5→v7 deferred

**Date:** 2026-04-24
**Decision:** Hold the `eslint`, `@eslint/js`, and `eslint-plugin-react-hooks` major bumps for a focused follow-up PR.
**Context:** During Sprint 2 Phase 2 (ESLint tightening), upgrading to ESLint 10 alongside the lint-config refactor would have made it impossible to tell which new findings were caused by the rule changes vs the version bump. react-hooks v7 in particular is a near-total rewrite (the React Compiler hook rules) and is expected to surface 5–30 new exhaustive-deps findings.
**Alternatives considered:**
- Bump in Phase 2: rejected — too much going on in one PR; would slow review.
- Skip until the v7 stabilizes further: rejected — the version is stable, the bump just needs focused triage time.
**Consequences:** Tracked as a follow-up issue. The Dependabot ignore list now covers all three packages so it doesn't try to bump them piecemeal.

---

## E2E tests run against production (temporarily)

**Date:** ~2026-03 (introduced); 2026-04-24 (documented as known limit)
**Decision:** Playwright E2E in CI hits the production URL with E2E-tagged service accounts.
**Context:** The first attempt to construct Vercel preview URLs from branch names (`<project>-git-<branch>-<team>.vercel.app`) failed — branch slugs longer than 63 chars get truncated, and the team-slug guess was wrong. The fallback was "just hit prod with a known-test cohort" and aggressively clean up E2E artifacts in `afterEach`.
**Alternatives considered:**
- Spin up a per-PR ephemeral Supabase project: rejected — the migration history is large and provisioning would dominate CI time.
- Use the Vercel deployment API to discover the preview URL for a given commit: planned for Sprint 3. Requires storing a Vercel API token in CI and adding a "wait for preview ready" step.
- Run E2E only on main: rejected — defeats the point of catching regressions before merge.
**Consequences:** E2E tests must be self-cleaning (every spec restores prod data via `afterEach`). The shared production DB means parallel CI runs (push + PR sync events) can step on each other; a `concurrency: e2e-playwright` gate in CI forces serial execution. Net cost is acceptable but real — listed as the next thing to fix in the runbook.

---

## Email provider: MailerSend over Resend

**Date:** 2026-04 (migration completed)
**Decision:** Switch the `send-email` edge function from the prior provider (Resend) to MailerSend.
**Context:** The prior provider's free tier wrapped every outbound link in a click-tracking proxy that couldn't be disabled — confirmation links, password resets, and waitlist offers all routed through a third-party redirector before reaching the user. This produced false-positive spam-filter hits and broke deep-linked URLs in some email clients. MailerSend's free tier doesn't proxy links and gives explicit per-message `track_clicks` / `track_opens` / `track_content` toggles which we set to `false`.
**Alternatives considered:**
- Stay on the prior provider and pay for the tracking-disabled tier: rejected — recurring cost on a pro-bono engagement.
- Use Supabase Auth's built-in transactional email (which uses Resend under the hood): rejected — same proxy issue, plus the templates aren't customizable.
- Postmark or SendGrid: viable, but MailerSend's free tier (3,000/mo) covered the projected volume and we already had a verified domain.
**Consequences:** All email goes through MailerSend now. The dual-provider fallback that briefly existed was deleted in April 2026; commit history has the old code path if needed.

---

## Authorization via Postgres RLS, not application middleware

**Date:** Project inception (2026-01)
**Decision:** Enforce all authorization rules in Postgres via Row Level Security policies. The frontend talks directly to PostgREST.
**Context:** Two things made RLS the obvious choice. First, the data model is small and well-bounded — 33 tables, three roles. The same RLS predicates apply to PostgREST queries, edge functions, and any future API consumers, so defining them once in SQL is genuinely DRY. Second, the alternative (a Node/Deno middleware layer that proxies the database) would have added an entire deployable to the stack — more code to maintain, more keys to rotate, more places for the auth check to drift out of sync.
**Alternatives considered:**
- Express/Fastify middleware that proxies queries: rejected — extra deploy target, doesn't catch direct PostgREST access if a frontend bug constructs the wrong URL.
- Application-level checks in React: rejected — bypassed by anyone with the publishable key and a curl command. UI checks are good UX but not a security primitive.
- Postgres role + grant matrix without RLS: rejected — too coarse; can't express "only this row's owner".
**Consequences:** RLS policies are now the single source of truth for "who can do what." The cost: writing policies is harder than writing middleware (less intuitive language, harder to test in isolation, can be deceptively expensive for joins). Three migrations have been needed specifically to fix policy bugs (`20260414000003_fix_rls_policies.sql`, `20260414130000_harden_rls_policies.sql`, `20260414000001_fix_security_advisor.sql`). The RLS reference doc exists because policy details are non-obvious. Net: acceptable trade — fixing a policy bug is a forward migration, not a redeploy.

---

## Supabase, not roll-your-own backend

**Date:** Project inception (2026-01)
**Decision:** Use Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) as the backend.
**Context:** Pro-bono engagement, single contributor. Time spent building auth flows, file uploads, realtime, and a postgres deploy is time not spent on Easterseals features. Supabase gives all five primitives behind a generous free tier. The realtime subscriptions in particular (used for messaging and unread counts) would have been a multi-week build with raw Postgres + Node.
**Alternatives considered:**
- AWS / GCP from scratch: rejected — operational cost, both money and time-to-first-feature, was prohibitive.
- Firebase: rejected — schema-less data model is a poor fit for the relational nature of bookings/shifts/coordinators.
- PlanetScale + Auth0 + Pusher: viable but three vendors to manage on a free engagement.
**Consequences:** All in on the Supabase ecosystem. RLS is the auth model (see entry above). Edge functions run Deno (different from the Node frontend, but isolated to ~8 functions and they don't share code with the SPA). Lock-in is real — migrating off would mean reimplementing RLS in app code, replacing Supabase Auth, etc. Worth it on this engagement; should be a conscious revisit if the org outgrows the free tier.

---

## Test concentration in `src/lib/`, not pages

**Date:** Sprint 1 (~2026-02)
**Decision:** Concentrate Vitest unit tests on `src/lib/` (booking-rules, slot-utils, calendar-utils, consistency-score). Pages and components are tested end-to-end with Playwright instead of with React Testing Library.
**Context:** The decision rule: a unit test pays for itself when the code under test is pure logic with branchy edge cases. Booking rules, slot math, consistency scoring — those are pure functions with messy inputs (DST transitions, cancellation timing, etc.) and benefit from fast unit tests. Page components are mostly orchestration: fetch data, render, dispatch a handler. Mocking Supabase to test that orchestration in isolation costs more than running a Playwright spec that just does the workflow.
**Alternatives considered:**
- Test every component with React Testing Library: rejected — high mock surface, low signal, brittle.
- Skip unit tests entirely, lean only on E2E: rejected — `src/lib/booking-rules.ts` has subtle off-by-one bugs that would be a nightmare to surface through E2E.
- Snapshot test pages: rejected — adds churn without catching real bugs.
**Consequences:** Vitest suite is small and fast (~30 tests, runs in <2s). Pages without unit tests rely on Playwright; gaps in Playwright coverage = real coverage gaps. Acceptable so far given small page count and high E2E coverage of the critical flows.

---

## Dependabot major-version ignores for React/ESLint/Vite/TS ecosystems

**Date:** 2026-04-24 (current state; entries added incrementally)
**Decision:** `.github/dependabot.yml` ignores major-version bumps for `react`, `react-dom`, `@types/react*`, `eslint`, `@eslint/js`, `@types/react-hooks`, `recharts`, `react-day-picker`, `react-resizable-panels`, `vite`, `@vitejs/plugin-react-swc`, and TypeScript itself.
**Context:** A truly automated upgrade flow is dangerous for major versions in tightly-coupled ecosystems. React 18 → 19 needs every Radix + shadcn dep validated; ESLint 9 → 10 is interlocked with `react-hooks` v5 → v7 (see entry above); Vite 5 → 6 → 7 changed plugin APIs in non-trivial ways. Letting Dependabot auto-PR these turns into a stream of red CI runs, each requiring manual triage — and one of them got auto-merged in PR #101 before strict-mode landed, which is part of why the strict-mode rollback story exists.
**Alternatives considered:**
- Allow majors and triage in PR: rejected — Dependabot will keep re-opening PRs as it sees newer versions, creating noise.
- Rely on patch + minor only forever: rejected — we *do* want major bumps eventually, just on our schedule.
- Use Renovate with grouping rules: viable, requires migrating the bot setup. Not worth it for this scope.
**Consequences:** Major bumps need to be done manually, which is a feature in disguise — it forces the maintainer to read the changelog. Each ignore entry has a comment in `.github/dependabot.yml` explaining the incident or rationale, so a future maintainer can see why a given package was added.

---

## Branch + PR + squash-merge, never push-to-main

**Date:** Project inception
**Decision:** Every change goes through a feature/fix/chore branch and a PR. Squash-merge to main. Branch protection blocks direct pushes.
**Context:** Single contributor or not, the audit trail of "what landed when, with what review and what tests" is the single most valuable artifact this project has post-handoff. A PR-per-change is also the only sane mechanism for `Lint + Vitest unit tests` and `Playwright E2E` to gate changes — without PRs there's nowhere to attach the checks.
**Alternatives considered:**
- Trunk-based development with feature flags: rejected — overkill for a single contributor.
- Allow direct push for hotfixes: rejected — adds an "emergency override" code path that gets abused. Hotfixes use a `hotfix/*` branch with the same PR flow, just with explicit "[HOTFIX]" tagging in the title.
**Consequences:** Small overhead per change (open a PR, wait for CI, merge). Pays for itself the first time the maintainer needs to bisect a regression — every commit on main has a PR with context, test output, and review trail.
