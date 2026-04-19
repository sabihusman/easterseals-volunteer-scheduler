# Migration History (Historical Reference Only)

These 66 SQL files are the original per-feature migrations produced during the
Lovable-authored phase of this project (March–early April 2026). They are
preserved here as a historical audit trail — the "why" and "when" of each
schema change.

## ⚠️ Do not apply these files

The live schema was re-baselined from a production `pg_dump` on
**2026-04-14** and committed as
[`supabase/migrations/20260101000000_baseline.sql`](../../supabase/migrations/20260101000000_baseline.sql).

That single baseline represents the **net effect** of all 66 files here,
plus the subsequent security-hardening migrations also in
`supabase/migrations/`. Re-running these archived files against any new
environment will:

- Double-create tables (fails on `CREATE TABLE` collision),
- Re-define functions that have since been replaced,
- Apply RLS policies that have since been tightened or renamed,
- Attempt extension moves that have already happened (`citext` → `extensions`).

If you need to reproduce the schema locally, run `supabase db reset` against
the files in `supabase/migrations/` — not these.

## What's here

Each file name is `YYYYMMDDHHMMSS_<UUID>.sql` — the UUID suffix was appended
by the original tooling. The filenames are chronological, so browsing the
directory in order tells the evolution story:

- Initial schema, profiles + departments + shifts (Mar 29–30)
- Booking flow + RLS lockdown (early April)
- Waitlist + slot-level capacity (mid April)
- Messaging + notifications (later April)
- MFA + document compliance (late April)

## When to reference them

- **Debugging a live bug:** to see when and why a column or policy was
  introduced, `grep` this directory for the column/policy name.
- **Restoring a dropped behavior:** if something in production turns out
  to be missing from the baseline, these files show the original intent.
- **Writing a retrospective or runbook:** the commit history + these files
  together document the full schema lineage.

## When NOT to reference them

- **Setting up a new Supabase project:** use `supabase/migrations/` only.
- **Writing a new migration:** don't copy-paste from here; the current
  canonical patterns are in the files still under `supabase/migrations/`.
