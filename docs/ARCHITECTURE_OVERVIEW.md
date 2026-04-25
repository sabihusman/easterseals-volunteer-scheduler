# Architecture Overview

## The problem and the solution

Easterseals Iowa coordinates several hundred volunteers across dozens of departments — Camp Sunnyside, Adult Day Services, grounds crews, special events. Before this app, scheduling lived in spreadsheets, group texts, and a coordinator's memory. The visible symptoms were no-shows surfacing the morning of, double-bookings discovered when two volunteers showed up for the same slot, and monthly reporting that required reconstructing hours from paper sign-in sheets. The hidden cost was bigger: every hour spent rebuilding the schedule was an hour not spent with a client, and the organization had no way to answer "which departments are under-staffed next week?"

The solution is a role-aware web app (with an Android wrapper via Trusted Web Activity) backed by Supabase. Volunteers browse open shifts filtered by their eligibility, book individual time slots within multi-hour shifts, and get automated email reminders. Coordinators see their department's coverage live and mark attendance from a phone. Admins see everything. Authorization is enforced in Postgres via Row Level Security, not just in the UI — the database refuses to leak data even if a frontend bug tried to. The same Postgres triggers that prevent overlapping bookings also auto-promote waitlisted volunteers when a confirmed volunteer cancels. See [DECISION_LOG.md](./DECISION_LOG.md) for why we chose this stack.

## System diagram

```
┌──────────────┐     HTTPS     ┌──────────────────────────┐
│  Browser /   │ ────────────► │  Vercel — Vite SPA + PWA │
│  Android TWA │               │  Static + edge routing   │
└──────┬───────┘               └──────────────────────────┘
       │
       │ Supabase JS client (JWT in localStorage)
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase project: esycmohgumryeqteiwla                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Postgres │  │   Auth   │  │ Storage  │  │ Edge         │  │
│  │  + RLS   │  │ + Turn-  │  │ (docs,   │  │ Functions    │  │
│  │  + cron  │  │  stile   │  │ avatars) │  │ (Deno, 8)    │  │
│  │  + 33    │  │ + MFA    │  │          │  │              │  │
│  │  tables  │  │          │  │          │  │              │  │
│  └────┬─────┘  └──────────┘  └──────────┘  └──────┬───────┘  │
│       │ realtime channels                          │           │
└───────┼──────────────────────────────────────────┬─┘           │
        │                                           │
        ▼                                           ▼
   Browser realtime                       ┌──────────────┬──────────────┐
   (messaging,                            │  MailerSend  │   Twilio     │
   notifications)                         │   (email)    │ (SMS, off)   │
                                          └──────────────┴──────────────┘

                                          ┌──────────────┬──────────────┐
                                          │    Sentry    │  Cloudflare  │
                                          │   (errors)   │   Turnstile  │
                                          └──────────────┴──────────────┘
```

## Frontend

**React 18 + Vite 5 + TypeScript** in strict mode (enforced by `tsc --build` in CI). Routing via **React Router v7** (`BrowserRouter` in [src/App.tsx](../src/App.tsx)) with two route guards:

- `ProtectedRoute` — checks `useAuth()` for a session and (optionally) a role match. Redirects unauthenticated users to `/auth`, role-mismatched users to their canonical dashboard.
- `AuthRoute` — inverse guard for the login page; bounces signed-in users to `/dashboard`.

Routes are organized by role (`/dashboard`, `/coordinator`, `/admin/*`) plus shared routes (`/messages`, `/settings`, `/events`).

**State** is split deliberately: server state goes through **TanStack Query** (`QueryClient` in App.tsx); transient UI state uses local `useState`; persistent auth state lives in [`AuthContext`](../src/contexts/AuthContext.tsx). There's no Redux — none of the cross-cutting state warranted it.

**Realtime subscriptions** use Supabase's `postgres_changes` channel pattern (see [`ConversationThread.tsx`](../src/components/messaging/ConversationThread.tsx)). The lookup-by-ID approach (subscribe to `messages` filtered by `conversation_id=eq.<id>`) avoids Supabase's broadcast cost ceiling while still giving sub-second message delivery. Notifications use the same pattern in [`useUnreadCount.ts`](../src/hooks/useUnreadCount.ts).

**Auth context** ([AuthContext.tsx](../src/contexts/AuthContext.tsx)) listens to `supabase.auth.onAuthStateChange` and fetches the user's profile (which includes role) on every auth change. **Critical:** the callback never `await`s a Supabase call directly — it defers every DB read with `setTimeout(..., 0)` to avoid deadlocking the GoTrue auth lock. This is a known pitfall in the Supabase JS client.

**UI** is built on **shadcn/ui** (47 components in `src/components/ui/`) on top of Radix UI, with Tailwind for utility styling. shadcn components are generated and committed to the repo so they can be customized in place.

**Forms** use **React Hook Form + Zod** for validation. **Toasts** use `useToast` (custom shadcn hook) with a Sonner backup for transient confirmations.

**PWA + Android:** [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) generates the service worker. The Android app is a Trusted Web Activity (same web bundle, packaged as an APK — see `docs/sprint4-android-setup.md`). [main.tsx](../src/main.tsx) detects the TWA context via `document.referrer.startsWith("android-app://")` and adds a `.twa` class to `<html>` for any Android-specific styling overrides.

## Backend

**Postgres** is the source of truth for all data. **33 tables** are grouped into 8 domains (Identity, Departments, Shifts, Bookings, Attendance, Communication, Volunteer Attributes, Auditing, Events) — see [SCHEMA_REFERENCE.md](./SCHEMA_REFERENCE.md) for the per-table reference.

**PostgREST** (built into Supabase) is the primary API. The frontend talks directly to Postgres via the Supabase JS client, with **all authorization enforced by RLS** — over 60 effective policies across the 33 tables, drawing on three SQL helper functions (`is_admin()`, `is_coordinator_or_admin()`, `is_coordinator_for_my_dept(uuid)`). See [RLS_REFERENCE.md](./RLS_REFERENCE.md) for the complete per-table policy list.

**Triggers** (40+, defined in `supabase/migrations/20260101000000_baseline.sql`) enforce the invariants RLS can't express: prevent overlapping bookings, demote a coordinator/admin who tries to book to waitlisted, auto-promote the next waitlist volunteer when a confirmed booking cancels, sync `shifts.booked_slots` from `shift_bookings` row counts, generate `shift_time_slots` rows when a shift is created, and recalculate `profiles.consistency_score` and `profiles.volunteer_points` whenever a booking transitions. Full list in [SCHEMA_REFERENCE.md](./SCHEMA_REFERENCE.md#triggers-and-jobs).

**Edge functions** (8, in `supabase/functions/`, Deno runtime):

| Function | Purpose |
|---|---|
| `send-email` | All transactional email via MailerSend; templates branded with Easterseals colors. Supports a sandbox mode that redirects all outbound mail to a test inbox. |
| `send-sms` | Twilio SMS sender. Off in production (`SMS_ENABLED=false`); will turn on once the Twilio account is upgraded past the trial verified-numbers restriction. |
| `notification-webhook` | Trigger from `INSERT ON notifications`. Routes notifications to email/SMS based on the recipient's preferences and the notification type. |
| `delete-user` | Admin-only RPC wrapper for cascading user deletion. Calls `auth.admin.deleteUser` after the FK cascades have run. |
| `admin-act-on-behalf` | Generates a short-lived impersonation token for an admin to act as a volunteer (e.g. to book on their behalf). Audited in `admin_action_log`. |
| `admin-reset-mfa` | Admin force-resets a user's MFA enrollment. Audited in `admin_mfa_resets`. |
| `mfa-recovery` | User-facing MFA recovery via backup codes. |
| `calendar-feed` | Generates a per-user `.ics` URL signed with the user's `profiles.calendar_token` so they can subscribe in Google/Apple Calendar. |

**pg_cron** runs 15 scheduled jobs (waitlist offer expiry, shift reminders, dispute auto-resolve, document expiry, etc.). **Important caveat:** only one of those jobs is in version control today. See [OPERATIONS_RUNBOOK.md § Cron jobs](./OPERATIONS_RUNBOOK.md#cron-jobs) for the full list and the inspection query, and [issue #116](https://github.com/sabihusman/easterseals-volunteer-scheduler/issues/116) for the export-to-migration follow-up.

## Integrations

- **MailerSend** — All transactional email. Switched from the previous provider in April 2026 because the previous provider's free tier wrapped every link with an unrelinquishable click-tracking proxy. See [DECISION_LOG.md § MailerSend](./DECISION_LOG.md#email-provider-mailersend-over-resend).
- **Twilio** — SMS sender. Currently disabled (`SMS_ENABLED=false` env var) because the trial account rejects unverified destination numbers; turn on after upgrading.
- **Sentry** — React SDK in [src/lib/sentry.ts](../src/lib/sentry.ts). Production-only: `initSentry()` no-ops if `import.meta.env.PROD === false` or `VITE_SENTRY_DSN` is empty. The `Sentry.ErrorBoundary` in [main.tsx](../src/main.tsx) catches render-phase errors and shows a recovery UI. Auth context tags every event with `user.id` / `user.email` / `user.role`.
- **Cloudflare Turnstile** — Bot protection on signup/signin. The site key (public, fine to ship) lives in `VITE_TURNSTILE_SITE_KEY`; the secret key is configured in the Supabase dashboard under Authentication → CAPTCHA Protection (Supabase Auth verifies the token natively).
- **Vercel Analytics + Speed Insights** — Auto-wired in [main.tsx](../src/main.tsx) via `@vercel/analytics/react` and `@vercel/speed-insights/react`; no additional setup needed.

## Deployment

**Vercel** hosts the SPA. Every push to a non-`main` branch gets an auto-generated preview URL via the Vercel-GitHub integration. **Production deploys** run through `.github/workflows/deploy.yml` on every push to `main`:

1. Install Supabase CLI (needed because the `prebuild` npm script runs `supabase gen types typescript --linked` to regenerate `src/integrations/supabase/types.ts` from the live schema before Vite compiles).
2. `supabase link --project-ref esycmohgumryeqteiwla` (idempotent).
3. `bun install` then `bunx vitest run` as a sanity check (the same tests already ran on the PR; this catches main-only flakiness).
4. `vercel pull --yes --environment=production` to fetch the prod env vars.
5. `vercel build --prod` (this triggers `prebuild` → `gen:types`).
6. `vercel deploy --prebuilt --prod`.

**Database migrations** are applied **manually** via `supabase db push --linked` — CI never touches the production schema. This is intentional; see [OPERATIONS_RUNBOOK.md § Applying a migration](./OPERATIONS_RUNBOOK.md#applying-a-database-migration).

**CI checks** that gate PR merges:

- `Lint + Vitest unit tests` — `bun run lint` (ESLint, max-warnings=100) → `bun run typecheck` (`tsc --build`) → `bunx vitest run`
- `Playwright E2E` — runs against the **production URL** (not a preview). See [DECISION_LOG.md § E2E against production](./DECISION_LOG.md#e2e-tests-run-against-production-temporarily) for why and the planned fix.
- `Comment test results on PR` — combines the two above into a single PR comment with the test output tail.

**Branch protection on `main`** requires the `Lint + Vitest unit tests` check to pass and a PR review; force-pushes are blocked.

## Known limitations

- **Free-tier ceilings** — Supabase free plan caps at 500MB DB / 1GB egress / 2GB bandwidth. Current usage is well under (production volume is ~50 active volunteers); upgrade triggers documented in [OPERATIONS_RUNBOOK.md § Upgrade triggers](./OPERATIONS_RUNBOOK.md#upgrade-triggers-for-pro-plans).
- **God components** — A few page components have grown past 600 lines (`AdminUsers.tsx`, `ManageShifts.tsx`, `ShiftConfirmation.tsx`). They handle state, data fetching, and presentation in one file. Slated for decomposition but not blocking; flagged here so a maintainer doesn't mistake the size for unfinished work.
- **`(supabase as any)` cast pattern** — Used at every RPC call site for RPCs the type generator doesn't cover (`waitlist_accept`, MFA functions, calendar feed). Documented in [eslint.config.js](../eslint.config.js); switching to typed RPC wrappers is deferred until type generation covers them upstream.
- **E2E suite hits production** — Tests create/cancel real shifts on the production DB (with E2E-tagged user accounts that the cleanup helpers aggressively prune). This exists because the early attempt to construct preview-deploy URLs from branch names couldn't reliably resolve them (see ci.yml comment). The proper fix is to use the Vercel deployment API to discover the preview URL for a given commit. Tracked as Sprint 3 work.
- **No iOS native wrapper** — Android ships as a Trusted Web Activity through the Play Store; iOS users get the PWA install prompt but no App Store presence. Out of scope for this engagement.
- **14 of 15 pg_cron jobs are dashboard-managed** — A fresh Supabase project will not recreate them automatically. See [issue #116](https://github.com/sabihusman/easterseals-volunteer-scheduler/issues/116).
- **Single-developer engagement ending** — All institutional knowledge is in this docs package and the commit history. The point of this Sprint 2 Phase 3 documentation effort is to make the handoff to a future maintainer clean.

For the day-one developer setup, jump to [ONBOARDING.md](./ONBOARDING.md). For the operator playbook, [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).
