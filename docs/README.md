# Documentation

Handoff documentation for the Easterseals Iowa Volunteer Scheduler. Read in order if you're new to the project; otherwise, jump to the doc that answers your question.

## Core handoff package

1. [**ARCHITECTURE_OVERVIEW.md**](./ARCHITECTURE_OVERVIEW.md) — How the pieces fit together. The frontend, the Supabase backend, the integrations, the deploy pipeline, and the known limitations. Start here.
2. [**ONBOARDING.md**](./ONBOARDING.md) — Day-one setup for a new contributor: prerequisites, clone + install, env vars, dev server, tests, the first PR workflow, and the common gotchas.
3. [**OPERATIONS_RUNBOOK.md**](./OPERATIONS_RUNBOOK.md) — How to run the app in production: deploy, rollback, secret rotation, the 15 cron jobs, edge function deployment, plan-upgrade triggers, and the incident-response playbook.
4. [**SCHEMA_REFERENCE.md**](./SCHEMA_REFERENCE.md) — Per-table reference for all 33 tables, plus the views, triggers, and pg_cron job catalog.
5. [**RLS_REFERENCE.md**](./RLS_REFERENCE.md) — Per-table list of every Row Level Security policy: who it allows, on which operation, and why.
6. [**DECISION_LOG.md**](./DECISION_LOG.md) — Architectural decisions and the reasoning behind them.

## Other docs (pre-existing)

- [SHIFT_LIFECYCLE.md](./SHIFT_LIFECYCLE.md) — How a shift moves through `open → full → cancelled → completed`, plus the 10 completed-shift invariants and where each is enforced.
- [play-store-listing.md](./play-store-listing.md) — Play Store launch checklist for the Android TWA.
- [sprint4-android-setup.md](./sprint4-android-setup.md) — Android Trusted Web Activity build setup.
- [migration-history/](./migration-history/) — Historical migration files. Reference only; do not apply.
- [archive/](./archive/) — Historical tech-spec snapshots (v3–v8, March–April 2026).

## Updating these docs

Treat the six core docs above as living references. When you change the schema, the cron schedule, the deploy pipeline, or a major architectural choice — update the corresponding doc in the same PR. Stale handoff docs are worse than no handoff docs.
