# Operations Runbook

Day-to-day operations for a maintainer running this app in production. Assumes you've read [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) and have shell access to the repo plus dashboard access to Vercel and Supabase.

## Deployment flow

**Production deploys are triggered by merging to `main`.** Vercel watches `main` indirectly — the canonical pipeline runs through GitHub Actions ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)):

1. PR opens against `main`, CI runs `Lint + Vitest unit tests` and `Playwright E2E`. Both must pass plus an approving review.
2. PR is squash-merged to `main`. The `Deploy` workflow fires.
3. Workflow steps:
   - Install Supabase CLI (needed because the `prebuild` npm script regenerates `src/integrations/supabase/types.ts` from the live schema).
   - `supabase link --project-ref esycmohgumryeqteiwla`.
   - `bun install` and `bunx vitest run` as a final sanity check.
   - `vercel pull` to fetch the prod env, `vercel build --prod`, `vercel deploy --prebuilt --prod`.
4. Vercel updates the production alias `easterseals-volunteer-scheduler.vercel.app`. Within ~30 seconds the new bundle is live globally.
5. **Database migrations do not auto-apply.** If your PR added a SQL file under `supabase/migrations/`, run `supabase db push --linked` manually — see below.

**To verify a deploy succeeded:**

```bash
gh run list --workflow Deploy --branch main --limit 1
curl -sI https://easterseals-volunteer-scheduler.vercel.app | head -1   # should be 200
```

## Applying a database migration

Migrations are **forward-only** and applied **manually** — by design. The `Deploy` workflow doesn't push SQL.

### Steps

1. Land the migration file in `main` first via a normal PR (the file lives in `supabase/migrations/<timestamp>_name.sql`). The PR's CI doesn't apply it; it just makes sure the rest of the codebase compiles assuming the schema change.
2. After merge, on your machine:
   ```bash
   git checkout main && git pull
   supabase login                                        # one-time
   supabase link --project-ref esycmohgumryeqteiwla      # one-time per clone
   supabase db push --linked
   ```
3. `supabase db push` shows you a diff of pending migrations and asks for confirmation. Read it. Postgres errors here are usually about missing privileges or syntax that worked in a personal project but not against the prod role; fix forward in a new migration.
4. After the push, `bun run gen:types` (or push the next deploy) will regenerate `types.ts` so the frontend types reflect the new schema.

### If a migration breaks production

Migrations are forward-only. If you applied a bad SQL change:

1. **Stop deploys.** Revert the offending migration's PR commit on `main` (or push a hotfix branch reverting the SQL changes the next deploy depends on). This won't undo the SQL — only future commits.
2. **Write a corrective migration.** New file `supabase/migrations/<timestamp>_fix_<name>.sql` that does the inverse: drops the bad column, restores the old constraint, etc.
3. Apply the corrective migration with `supabase db push --linked`.
4. Cut a new deploy from `main`.

The reason there's no `supabase db reset` in this playbook is the production DB has user data. Reset would wipe it.

## Rolling back a deploy

Two layers — frontend and database — and rolling back the frontend is much easier. **Always check what actually broke before rolling back the database**; if the bug is purely frontend, only roll the frontend back.

### Frontend rollback (Vercel)

**Fastest (UI):**
1. Vercel dashboard → Deployments
2. Find the last good deploy (status: Ready, branch: main)
3. Click `…` → "Promote to Production"
4. Within seconds, the production alias points to the older bundle

**Via CLI:**
```bash
vercel rollback [DEPLOYMENT_URL] --token=$VERCEL_TOKEN
```

You can find `DEPLOYMENT_URL` in `vercel ls`. Do not use `vercel rm` to delete the bad deployment — keep it for forensics.

**Via git revert (slower, more durable):**
```bash
git revert <bad-merge-sha> -m 1
git push origin main
```
This triggers the Deploy workflow with the reverted code. Use this when you want the rollback in the commit history (e.g. a security issue).

### Database rollback

Postgres doesn't have a built-in rollback; you write a corrective forward migration (see § Applying a database migration → "If a migration breaks production"). For accidentally-deleted data, Supabase Pro has Point-in-Time Recovery — the free tier does daily backups only (Settings → Database → Backups in the dashboard).

## Rotating a secret

Secrets live in three places, each rotated differently:

### Supabase service-role key

If leaked: regenerate from Supabase dashboard → Settings → API → "Regenerate service_role key". This **immediately invalidates** the old key. Then update:

- GitHub Actions secret `SUPABASE_SERVICE_ROLE_KEY` (Settings → Secrets and variables → Actions, plus Dependabot's separate namespace if E2E uses it).
- Any Vercel env vars referencing it (probably none — the frontend uses the publishable key).
- Local `.env.local` files (warn the team).

### MailerSend API key

1. MailerSend dashboard → API → revoke the leaked token, generate a new one.
2. Update Supabase project secrets:
   ```bash
   supabase secrets set MAILERSEND_API_KEY=<new-key>
   ```
3. The next edge function invocation picks up the new value (no redeploy needed).

### Twilio auth token

If `SMS_ENABLED=true` (it isn't in production today, but plan for it):

1. Twilio Console → Account → API keys & tokens → "Rotate Auth Token".
2. `supabase secrets set TWILIO_AUTH_TOKEN=<new-token>` (and `TWILIO_ACCOUNT_SID` if you regenerated that too).

### Vercel deploy token

Used by `.github/workflows/deploy.yml`. If leaked:

1. Vercel dashboard → Settings → Tokens → revoke → create new.
2. Update GitHub Actions secret `VERCEL_TOKEN` (and the Dependabot mirror).

### Cloudflare Turnstile secret

Configured in the **Supabase dashboard** (Authentication → Sign In → CAPTCHA Protection), not as an env var. Rotate by generating a new key in Cloudflare → updating the dashboard field. The widget site key (`VITE_TURNSTILE_SITE_KEY`) only needs to change if you also rotated that.

## Responding to user reports

When a volunteer or coordinator says "X isn't working":

1. **Check Sentry** (project: `easterseals-volunteer-scheduler`). Filter by `user.email = <reporter>` to see their last few errors. Sentry has the user's role tag, the route they were on, and the React component stack.
2. **Check Vercel Logs** (dashboard → Logs) if Sentry has nothing. Vercel logs every request to the SPA — useful for "the page won't load" complaints (probably a cold-start or asset 404).
3. **Check edge function logs** (Supabase dashboard → Edge Functions → select the function → Logs) for email/SMS issues. Every error is a structured JSON line: `{ fn, level, error: { message, stack } }`. Filter by `fn=send-email` or whichever function applies.
4. **Check Postgres logs** (Supabase dashboard → Database → Logs) for "row-level security" or constraint-violation messages — these are usually the volunteer hitting a guardrail trigger (e.g. trying to book a shift that has ended).
5. **Reproduce as the user** if needed. Use the admin "Act on Behalf" flow (audited in `admin_action_log`) — never log in *as* a volunteer with their password; that bypasses the audit trail.

## Checking production health

Quick five-minute health pass — run this if a metric or alert sounds off:

```bash
# Frontend reachable?
curl -sI https://easterseals-volunteer-scheduler.vercel.app | head -1     # 200

# Last deploy succeeded?
gh run list --workflow Deploy --branch main --limit 3

# Edge functions responding?
curl -sI https://esycmohgumryeqteiwla.supabase.co/functions/v1/send-email \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" -X OPTIONS | head -1      # 200/204
```

Then in the Supabase dashboard:

- **Database → Query Performance** — top slow queries. Anything > 500ms on a hot path (shifts, profiles) needs an index review.
- **Auth → Logs** — look for spike in "invalid_credentials" (potential credential-stuffing attempt).
- **Database → Disk Usage** — warn at 80% of plan limit (free is 500MB).
- **API → Bandwidth** — same. Free tier is 1GB/month egress.

Sentry's release-health view shows crash-free session rate over time. Expect 99%+ on a healthy day.

## Edge function deployment

Edge functions live in `supabase/functions/<name>/index.ts`. They are **not** deployed by `.github/workflows/deploy.yml` — Vercel doesn't host them, Supabase does.

**To deploy a single function:**
```bash
supabase functions deploy <name> --project-ref esycmohgumryeqteiwla
```

**To deploy all functions:**
```bash
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  supabase functions deploy "$name" --project-ref esycmohgumryeqteiwla
done
```

**To set/update secrets that an edge function needs:**
```bash
supabase secrets set MAILERSEND_API_KEY=<value> --project-ref esycmohgumryeqteiwla
```

**To inspect runtime logs:** dashboard → Edge Functions → select the function → Logs tab.

## Cron jobs

The app runs **15 pg_cron jobs**. **Critical:** only one of them is in version control today.

### The full list

| Job | Schedule | Purpose |
|---|---|---|
| `dispute-auto-resolve` | `17 * * * *` | Hourly. Auto-resolves attendance disputes >7 days old in the volunteer's favor. |
| `expire-documents-daily` | `0 7 * * *` | Daily 07:00 UTC. Marks volunteer documents whose `expires_at` has passed as `expired`. |
| `expire-shift-invitations` | `*/15 * * * *` | Every 15 min. Marks unaccepted `shift_invitations` past `expires_at` as `expired`. |
| `prune-read-notifications` | `0 8 * * *` | Daily 08:00 UTC. Deletes notifications that are read **and** older than 90 days. |
| `reconcile-shift-counters` | `0 9 * * *` | Daily 09:00 UTC. Recomputes `shifts.booked_slots` from `shift_bookings` row counts in case a trigger ever miscounted. |
| `rotate-checkin-tokens` | `0 * * * *` | Hourly. Rotates `checkin_tokens` whose `rotation_mode` is non-`none`. |
| `self-confirmation-reminder` | `*/30 * * * *` | Every 30 min. Nudges volunteers whose shift ended <6h ago to self-confirm attendance. |
| `shift-reminder-24h` | `0 * * * *` | Hourly. Sends 24-hour-before reminders for upcoming shifts. |
| `shift-reminder-2h` | `30 * * * *` | Hourly at :30. Sends 2-hour-before reminders. |
| `shift-status-transition` | `*/15 * * * *` | Every 15 min. Marks past shifts `completed`. **Only one in version control** ([20260415000000_shift_lifecycle_rules.sql](../supabase/migrations/20260415000000_shift_lifecycle_rules.sql)). |
| `unactioned-shift-auto-delete` | `0 8 * * *` | Daily 08:00 UTC. No-shows the booking for shifts unconfirmed after 7 days. |
| `unactioned-shift-coordinator-reminder` | `0 15 * * *` | Daily 15:00 UTC. Reminds coordinators when a volunteer hasn't confirmed an ended shift. |
| `unactioned-shift-volunteer-reminder` | `0 15-22 * * *` | Hourly 15:00–22:00 UTC. Reminds the volunteer to confirm — within the 48-hour confirmation window. |
| `waitlist-offer-expire` | `*/5 * * * *` | Every 5 min. Expires unaccepted waitlist offers, promotes the next person. |
| `warn-expiring-documents-daily` | `0 13 * * *` | Daily 13:00 UTC. Warns volunteers whose documents expire in ≤30 days. |

### Inspecting live state

Run this in the Supabase SQL Editor (Database → SQL Editor → new query):

```sql
SELECT jobname, schedule, active
FROM cron.job
ORDER BY jobname;
```

For per-run history (last successful run, errors, average runtime):

```sql
SELECT j.jobname, jrd.status, jrd.start_time, jrd.end_time,
       jrd.return_message
FROM cron.job j
LEFT JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
WHERE jrd.start_time > now() - interval '24 hours'
ORDER BY jrd.start_time DESC;
```

### Why this matters for handoff

**14 of the 15 jobs live only in the Supabase dashboard.** A fresh project will not recreate them automatically. Anyone setting up a new environment (staging, disaster recovery, migration to a new Supabase org) needs to manually re-create those 14 jobs.

The fix — exporting them to a single migration file — is tracked in [issue #116](https://github.com/sabihusman/esterseals-volunteer-scheduler/issues/116). Until that lands, treat the dashboard as the source of truth and **export your changes** any time you tweak a cron schedule:

```sql
-- Export the current state to share with a teammate or paste into a migration:
SELECT format(
  'SELECT cron.schedule(%L, %L, %L);',
  jobname, schedule, command
) AS recreate_sql
FROM cron.job
ORDER BY jobname;
```

## Upgrade triggers for Pro plans

The free tier of every dependency is currently sufficient for the volunteer load (~50 active volunteers, ~200 bookings/month). Watch for these triggers:

### Supabase free → Pro ($25/mo)

Upgrade when:

- **Database storage > 400 MB** (free cap: 500 MB). Run `SELECT pg_size_pretty(pg_database_size(current_database()));` monthly.
- **Egress bandwidth > 1.6 GB / month** (free cap: 2 GB). Visible in Supabase dashboard → Reports.
- **You need Point-in-Time Recovery.** Free has daily backups only; PITR comes with Pro.
- **You hit auth user cap** — free is 50,000 monthly active users. Easterseals won't, but listed for completeness.

### Vercel Hobby → Pro ($20/mo)

Upgrade when:

- **Bandwidth > 80 GB / month** (Hobby cap: 100 GB).
- **You need team seats** beyond the single Hobby account.
- **Build minutes exceed 6,000/mo** (Hobby cap). The current weekly merge cadence is well under.

### MailerSend free → starter ($28/mo)

Upgrade when **email volume > 2,800/month** (free cap: 3,000 with a verified domain). At ~100 weekly active volunteers and ~5 emails/volunteer/week, you're at ~2,000/mo today.

### Twilio trial → paid

Required *before enabling SMS*. Trial accounts can only send to verified destination numbers, which makes it useless for actual volunteers. Cost is per-message; budget ~$0.01/SMS US.

## Incident response playbook

Three classes; treat them differently.

### Credential leak (severity: critical)

If a service-role key, an admin password, or a Vercel deploy token shows up in a public commit, a screenshot, or a third-party tool's logs:

1. **Within 15 minutes:** rotate the leaked secret (see § Rotating a secret). Old key is invalid the moment you regenerate.
2. **Within 1 hour:** review the credential's audit trail. For Supabase service-role: Supabase logs filtered by IP. For Vercel: deploys list — anything from an unknown IP since the leak.
3. **Within 24 hours:** if the leak was in a git commit, history-rewrite the commit (`git filter-repo`) and force-push (after coordinating with the team). Delete any forks. **Note:** rotation is the real fix; rewriting history just reduces casual exposure.
4. **Within 72 hours:** post-mortem doc explaining what leaked, the rotation timeline, and a control to prevent recurrence (pre-commit hook, secret-scanning, etc.).

### Data exposure (severity: high)

If RLS misconfiguration lets a volunteer read another volunteer's row, or a private note becomes visible to a coordinator who shouldn't see it:

1. **Reproduce in a test session** (use the Act on Behalf flow, not real users) to confirm the scope.
2. **Patch the policy.** Write a migration that fixes the offending RLS policy. Apply via `supabase db push --linked`.
3. **Check audit logs** for evidence of the misconfiguration being exploited. If yes, treat as a breach (notify legal if user PII was viewed by an unauthorized account).
4. **Add a Vitest or Playwright case** that would have caught it. Test with a real second-volunteer account asserting they get `403`/`null` on the protected resource.

### Production outage (severity: variable)

If the app is down or unusably slow:

1. **Triage the layer.** `curl -sI https://easterseals-volunteer-scheduler.vercel.app` — if non-200, frontend is down. If 200 but the app shows blank, it's runtime (check Sentry). If page loads but actions fail, backend is the issue (check Supabase status: status.supabase.com).
2. **Vercel issue:** rollback to the previous deploy (see § Rolling back a deploy). Investigate after.
3. **Supabase issue:** if their status page shows a regional incident, communicate to users and wait. If it's our DB specifically, check `pg_stat_activity` for long-running queries that might be holding locks.
4. **Edge function issue:** check the function's logs. A failed deploy of a single function won't take down the app — only the affected feature (email, calendar feed, etc.).
5. **Communicate.** Slack/email to coordinator group: "we're aware of X, ETA Y." Silence is worse than uncertainty.

## Contact / escalation

- **Tech owner during this engagement:** Sabih Usman (sabih.usman@gmail.com).
- **Supabase project ID:** `esycmohgumryeqteiwla` (org owner: Easterseals Iowa account).
- **Vercel project:** `easterseals-volunteer-scheduler`.
- **GitHub repo:** `sabihusman/easterseals-volunteer-scheduler`.

For the schema-level reference (every table, column, trigger), see [SCHEMA_REFERENCE.md](./SCHEMA_REFERENCE.md). For the policy-level reference, [RLS_REFERENCE.md](./RLS_REFERENCE.md). For why the platform decisions were made, [DECISION_LOG.md](./DECISION_LOG.md).
