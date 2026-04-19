# Easterseals Iowa Volunteer Scheduler

A web + Android app that coordinates hundreds of volunteers across every Easterseals Iowa department — from Camp Sunnyside day camps to the Adult Day Services floor — in a single self-service workflow.

**Live:** https://easterseals-volunteer-scheduler.vercel.app

---

## The problem

Easterseals Iowa runs dozens of programs that depend on volunteers — from grounds crews and special-events staffing to one-on-one companions in Adult Day Services. Scheduling all of it used to live in spreadsheets, group texts, and a coordinator's memory. The visible symptoms were familiar: no-shows that weren't flagged until the morning of, double-bookings that only surfaced when two volunteers showed up for the same seat, and monthly reporting that required a coordinator to reconstruct hours from paper sign-in sheets.

The less-visible cost was bigger. Every hour a coordinator spent rebuilding the schedule was an hour not spent with a client. Volunteers who had a bad booking experience — no confirmation, no reminder, wrong location — didn't come back. The organization had no dashboard to answer a simple question like "which departments are under-staffed next week?"

Solving this was a prerequisite for scaling the volunteer program. Pen-and-paper coordination tops out around 50 active volunteers; Easterseals Iowa needs to sustain several hundred.

## The solution

A role-aware web app with a first-party Android wrapper. Volunteers browse open shifts filtered by their eligibility (background check status, department restrictions, booking-window privileges earned through consistency) and book individual 2-hour slots within multi-hour shifts. Coordinators see a live view of their department's coverage and can mark attendance from a phone at the volunteer table. Admins see everything.

What's built:

- **Role-based access** — volunteer / coordinator / admin, enforced by Postgres Row Level Security (not just UI guards)
- **Per-slot shift booking** with automatic waitlist offers when a spot opens up
- **Consistency scoring + booking privileges** — reliable volunteers earn a longer booking window (3 weeks vs 2)
- **Check-in / check-out** via QR codes scanned at the volunteer table
- **Automated notifications** — email (MailerSend) and SMS-when-enabled (Twilio) for bookings, reminders, confirmations, cancellations, waitlist offers
- **Compliance tracking** — background checks, parental consents for minors, document expiry warnings
- **Impact reporting** — CSV and PDF exports of volunteer hours, aggregates, and individual service-hours letters
- **Android installable app** via Trusted Web Activity (same codebase, published through Play Store)
- **Operational observability** — Sentry for error tracking, structured logs from every edge function

What's planned but not yet built (Sprint 2+):

- Rich messaging inbox between coordinators and volunteers
- Document storage (background-check certificates, training records) beyond expiry-date tracking
- A native iOS wrapper (Android TWA ships today; iOS users get the PWA)

## Live application

- **Web:** https://easterseals-volunteer-scheduler.vercel.app — works in any modern browser (Chrome, Safari, Firefox, Edge)
- **PWA install:** From Chrome on desktop or mobile, open the site and choose "Install" / "Add to Home Screen"
- **Android:** Play Store listing in progress — see `docs/play-store-listing.md`

---

## For developers

### Stack

- **Frontend:** React 18 + TypeScript + Vite, Tailwind + shadcn/ui, TanStack Query, React Router v7, React Hook Form + Zod
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime + Edge Functions on Deno). 34 tables, 70+ RPC functions, 2 views
- **Email / SMS:** MailerSend + Twilio, orchestrated through edge functions
- **Observability:** Sentry (React SDK)
- **Testing:** Vitest (unit + integration), Playwright (E2E)
- **Deploy:** Vercel via GitHub Actions

### Prerequisites

- Node.js **22+** (the repo is tested on 22.x; 20 is probably fine but not CI-gated)
- [Bun](https://bun.sh/) (preferred) or npm — `bun.lock` is the source of truth
- [Supabase CLI](https://supabase.com/docs/guides/cli) — required for `npm run build` because the prebuild step regenerates `src/integrations/supabase/types.ts` from the linked project
- A Supabase account with at least read access to the production project (or a personal project linked via `supabase link`)

### Setup

```bash
git clone https://github.com/sabihusman/easterseals-volunteer-scheduler
cd easterseals-volunteer-scheduler

# 1. Install dependencies
bun install   # or: npm install

# 2. Copy env vars
cp .env.example .env
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and any
# optional vars you want (Sentry, Turnstile, etc). See .env.example for
# the full list and scope annotations.

# 3. Link your Supabase project (once per clone)
supabase login
supabase link --project-ref esycmohgumryeqteiwla

# 4. Run the dev server
bun run dev        # http://localhost:8080
```

The first `bun run build` regenerates `src/integrations/supabase/types.ts` via the `prebuild` script. If you don't have Supabase CLI set up, the committed copy of `types.ts` will stay in place — but CI/deploys require it.

### Testing

```bash
bun run test          # Vitest — unit + integration tests
bun run test:watch    # Vitest in watch mode
bun run test:e2e      # Playwright — runs against PLAYWRIGHT_BASE_URL (defaults to prod in CI; override to http://localhost:8080 for local)
bun run lint          # ESLint with 100-warning ceiling
```

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch conventions (`feature/*`, `fix/*`, `chore/*`), PR rules, and the workflow for database migrations.

---

## For operators

### Environment variables

See [`.env.example`](./.env.example) at the repo root. Variables are grouped by scope (`[frontend]`, `[edge]`, `[ci]`, `[dashboard]`) with inline comments. Production values live in three places:

- **Vercel dashboard:** frontend `VITE_*` vars
- **Supabase project secrets:** edge-function vars (MailerSend, Twilio, sandbox toggles) — set via `supabase secrets set ...`
- **GitHub Actions secrets:** CI-only vars (Vercel tokens, E2E credentials, Android keystore). Duplicate into `Settings → Secrets → Dependabot` so dependabot PRs can run E2E against them

### Deployment

- **Preview:** Every push to a non-`main` branch gets a Vercel preview URL via the GitHub Actions integration
- **Production:** Merge to `main` → `.github/workflows/deploy.yml` runs Vitest sanity, pulls Vercel env, runs `vercel build --prod` (which triggers the `prebuild` types regen), and deploys via `vercel deploy --prebuilt --prod`
- **Database:** Migrations in `supabase/migrations/` applied manually via `supabase db push --linked` — CI does not auto-apply SQL changes (by design)

### Monitoring

- **Errors / performance:** Sentry project `easterseals-volunteer-scheduler`. Production is gated by `VITE_SENTRY_DSN`; set to empty to disable.
- **Analytics:** Vercel Analytics + Speed Insights (auto-wired, no dashboard setup needed)
- **Edge function logs:** Supabase dashboard → Edge Functions → Logs. Every error is a structured JSON line with `fn`, `level`, `error` for easy grep.

### Support contacts

- **Tech owner:** Sabih Usman (sabih.usman@gmail.com) — pro-bono sole contributor through Apr 2026
- **Product owner:** TBD post-handoff

---

## Architecture

```
┌──────────────┐     HTTPS     ┌────────────────────────┐
│   Browser /  │ ────────────→ │   Vercel (Vite build)  │
│   Android    │               │   Static SPA + PWA     │
└──────┬───────┘               └────────────────────────┘
       │
       │ Supabase client (JWT)
       ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase — esycmohgumryeqteiwla                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Postgres │  │   Auth   │  │ Storage  │  │   Edge   │ │
│  │  + RLS   │  │ (Turn-   │  │          │  │ Functions│ │
│  │  + Crons │  │ stile)   │  │          │  │  (Deno)  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────┬─────┘ │
│                                                  │       │
└──────────────────────────────────────────────────┼───────┘
                                                   │
                      ┌────────────────┬───────────┴───────────┐
                      ▼                ▼                       ▼
               ┌────────────┐   ┌────────────┐         ┌────────────┐
               │ MailerSend │   │   Twilio   │         │   Sentry   │
               │  (email)   │   │   (SMS)    │         │  (errors)  │
               └────────────┘   └────────────┘         └────────────┘
```

For the detailed system map, see `docs/ARCHITECTURE_OVERVIEW.md` (planned for Sprint 2).

---

## Documentation

- [`.env.example`](./.env.example) — environment variable reference
- [`docs/SHIFT_LIFECYCLE.md`](./docs/SHIFT_LIFECYCLE.md) — how shifts move through status; the 10 completed-shift invariants and their enforcement layers
- [`docs/play-store-listing.md`](./docs/play-store-listing.md) — Play Store launch checklist
- [`docs/sprint4-android-setup.md`](./docs/sprint4-android-setup.md) — Android TWA build setup
- [`docs/migration-history/`](./docs/migration-history/) — historical migration files (reference only; do not apply)
- **Planned (Sprint 2):** `docs/ARCHITECTURE_OVERVIEW.md`, `docs/RUNBOOK.md`, `docs/API_REFERENCE.md`, `docs/PRIVACY.md`

---

## License and attribution

Built for Easterseals Iowa. Sole contributor: **Sabih Usman**. Pro bono.

No license granted to redistribute or re-use this codebase outside the Easterseals Iowa engagement without written permission from the author.
