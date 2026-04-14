# Easterseals Iowa Volunteer Scheduler — Technical Specification

**Version:** 1.1  
**Last updated:** 2026-04-10  
**Repository:** github.com/sabihusman/easterseals-volunteer-scheduler  
**Production:** easterseals-volunteer-scheduler.vercel.app

---

## 1. Overview

Web application for managing volunteer shifts across departments at Easterseals Iowa. Role-based workflows for volunteers (browse/book shifts), coordinators (manage department schedules, confirm attendance), and administrators (org-wide control, user management, compliance).

---

## 2. Technology Stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | React 18.3 |
| Build | Vite 5.4 |
| Language | TypeScript 5.8 |
| Routing | react-router-dom 6.30 |
| Data fetching | @tanstack/react-query 5.83 |
| Forms | react-hook-form + zod |
| Styling | Tailwind CSS 3.4 + tailwindcss-animate |
| UI components | shadcn/ui (Radix primitives) |
| Icons | lucide-react |
| Date handling | date-fns 3.6 |
| Theme | next-themes (dark/light) |
| Charts | recharts 2.15 |
| PWA | vite-plugin-pwa |

### Backend / Infrastructure

| Layer | Technology |
|---|---|
| Database | Supabase (PostgreSQL 15) |
| Auth | Supabase Auth (email/password, MFA/TOTP, Cloudflare Turnstile) |
| Storage | Supabase Storage (volunteer-documents, shift-attachments) |
| Edge functions | Supabase Edge Runtime (Deno) |
| Email | MailerSend / Resend |
| SMS | Twilio |
| Hosting | Vercel |
| Real-time | Supabase Realtime (notifications, messages, unread counts) |
| Cron | pg_cron (waitlist expiry, shift reminders, counter reconciliation) |

### Dev / CI

| Tool | Purpose |
|---|---|
| Bun | CI package install + test runner |
| Vitest 3.2 | Unit + integration tests (80 tests) |
| Playwright 1.57 | Browser-driving E2E tests (5 tests) |
| ESLint 9 | Linting (--max-warnings=100) |
| GitHub Actions | CI: lint + vitest + playwright + PR comment |

---

## 3. Architecture

```
Vercel (React SPA + PWA + TWA for Android)
        |
        | supabase-js (auth + REST + realtime)
        v
Supabase (PostgreSQL + Auth + Storage + Edge Functions)
        |
        +-- MailerSend/Resend (email)
        +-- Twilio (SMS)
```

**Request flow:** Client issues `supabase.from("table").select/insert/update` → PostgREST applies JWT + RLS → triggers fire for business logic (capacity enforcement, counter sync, waitlist promotion) → row returned.

**Notification flow:** Client inserts into `notifications` → Postgres trigger calls `net.http_post` to `notification-webhook` edge function → webhook checks user preferences → routes to `send-email` and/or `send-sms`.

---

## 4. User Roles

| Role | Capabilities |
|---|---|
| **volunteer** | Browse/book shifts, view history, upload documents, private notes, messaging, self-confirm attendance |
| **coordinator** | Manage shifts in assigned departments, confirm attendance, view department volunteers, send direct/bulk messages, reports |
| **admin** | Full org-wide access: user management, department management, document compliance review, cross-department reports, org settings |

**Admin cap:** Maximum 2 admin accounts.  
**Coordinator ↔ department:** Many-to-many via `department_coordinators` table.

---

## 5. Data Model (Key Tables)

### Core Entities

| Table | Purpose | Key columns |
|---|---|---|
| `profiles` | User metadata | role, is_active, booking_privileges, bg_check_status, consistency_score, extended_booking, volunteer_points, signin_count |
| `departments` | Org units | name, requires_bg_check, is_active |
| `shifts` | Bookable time slots | department_id, shift_date, start_time, end_time, total_slots, booked_slots, status, created_by |
| `shift_bookings` | Volunteer commitments | shift_id, volunteer_id, booking_status (confirmed/waitlisted/cancelled), confirmation_status, final_hours, waitlist_offer_expires_at |
| `shift_time_slots` | Auto-generated sub-slots for shifts > 4h | shift_id, slot_start, slot_end, total_slots, booked_slots |
| `volunteer_shift_reports` | Self-reported attendance | booking_id, volunteer_id, self_confirm_status, self_reported_hours, star_rating |
| `volunteer_private_notes` | Private notes (no admin read) | volunteer_id, shift_id, content, is_locked |
| `volunteer_documents` | Uploaded certifications | volunteer_id, document_type_id, status (pending_review/approved/rejected), file_path |
| `conversations` / `messages` | Messaging | conversation_type (direct/bulk), cleared_at for local delete |
| `notifications` | In-app + email/SMS routing | user_id, type, title, message, link, is_read, data (jsonb) |

### Triggers (Business Rules in PostgreSQL)

| Trigger | Table | Purpose |
|---|---|---|
| `generate_shift_time_slots` | shifts | Auto-create sub-slots (SECURITY DEFINER) |
| `validate_booking_slot_count` | shift_bookings | Enforce capacity; demote to waitlisted if full |
| `sync_booked_slots` | shift_bookings | Keep shifts.booked_slots = real confirmed count |
| `prevent_overlapping_bookings` | shift_bookings | Reject overlapping bookings (skips on metadata-only updates) |
| `enforce_booking_window` | shift_bookings | 14-day default / 21-day extended window |
| `enforce_volunteer_role` | shift_bookings | Only volunteers can book |
| `trg_waitlist_promote_on_cancel` | shift_bookings | Offer slot to next waitlisted volunteer |
| `trg_recalculate_consistency` | shift_bookings | Recompute consistency score on state change |

### Cron Jobs (pg_cron)

| Job | Schedule | Purpose |
|---|---|---|
| `waitlist-offer-expire` | */5 * * * * | Delete expired waitlist offers, promote next |
| `shift-reminder-24h` | 0 * * * * | Reminder 1 day before shift |
| `shift-reminder-2h` | 30 * * * * | Reminder 2 hours before shift |
| `self-confirmation-reminder` | */30 * * * * | Prompt volunteer to confirm after shift ends |
| `unactioned-shift-volunteer-reminder` | 0 15-22 * * * | Nudge volunteer 12-48h after shift |
| `unactioned-shift-coordinator-reminder` | 0 15 * * * | Alert coordinator 48h-7d after shift |
| `unactioned-shift-auto-delete` | 0 8 * * * | Remove unconfirmed bookings after 7 days |

---

## 6. Authentication & RLS

### Authentication

- Email/password via Supabase Auth (GoTrue)
- Username sign-in via `get_email_by_username` RPC
- Cloudflare Turnstile on auth forms (currently disabled for E2E testing)
- MFA (TOTP) with 10 backup codes
- New users created with `is_active = false` — admin must activate

### Key RLS Policies

| Table | Policy | Rule |
|---|---|---|
| `profiles` | volunteer read staff | Admins always visible; coordinators visible if shared department booking |
| `shifts` | public SELECT | All authenticated users |
| `shift_bookings` | own rows + dept coordinators | Volunteers see own; coordinators see their departments |
| `volunteer_documents` | admin-only UPDATE | Coordinators can read but NOT approve/reject |
| `volunteer_private_notes` | owner only | No admin read access (intentional) |
| `shift_time_slots` | deny client write | Restrictive; only SECURITY DEFINER triggers can mutate |
| `conversations` | creator + participants | Creator can read their own insert (for RETURNING) |

---

## 7. Features

### Booking Lifecycle

```
(none) → confirmed → cancelled
                  ↘ waitlisted → confirmed (via offer accept)
                                → cancelled (via decline/expire)
cancelled → waitlisted (re-activation)
```

- **Booking window:** 14 days (default), 21 days (if consistency score ≥ 90% over 5+ shifts)
- **Waitlist:** 2-hour acceptance window; auto-promote on cancel; cron expires unclaimed offers
- **Overlap prevention:** Same volunteer can't book overlapping shifts on the same date
- **Confirmation:** Volunteer self-confirms after shift ends; coordinator can also confirm

### Consistency Score

- Rolling window: last 5 completed shifts
- `attended = confirmed bookings where confirmation_status != 'no_show'`
- `score = round(attended / total * 100)` — NULL until 5 shifts completed
- `extended_booking = true` when score ≥ 90 AND total ≥ 5

### Notification Types

| Type | Trigger | Channels |
|---|---|---|
| `booking_confirmed` | Volunteer books or promoted from waitlist | in-app + email + SMS |
| `booking_cancelled` | Volunteer cancels | in-app + email |
| `shift_cancelled` | Admin cancels shift | in-app + email + SMS |
| `shift_reminder` | 1 day / 2 hours before | in-app + email + SMS |
| `self_confirmation_reminder` | Shift ended, pending confirmation | in-app + email |
| `waitlist_offer` | Promoted from waitlist | in-app + email + SMS |
| `new_message` | Message received | in-app + email |
| `late_cancellation` | Cancel < 12h before shift | in-app + email (coordinator) |

Each type respects per-user opt-out preferences (`notif_shift_reminders`, `notif_new_messages`, `notif_booking_changes`, etc.) plus global `notif_email` / `notif_sms` toggles.

---

## 8. Edge Functions

| Function | Purpose |
|---|---|
| `send-email` | Templated transactional email via MailerSend/Resend. Sandbox mode via `EMAIL_SANDBOX` env var. |
| `send-sms` | SMS via Twilio. Only sends to volunteer's own phone (no emergency contact fallback). |
| `notification-webhook` | Routes notifications to email/SMS based on type + user preferences. |
| `delete-user` | Admin cascade delete (auth + profile + bookings). |
| `admin-act-on-behalf` | Admin impersonation for support. |
| `admin-reset-mfa` | Clear user's MFA when they lose their device. |
| `mfa-recovery` | Validate backup code and disable MFA. |
| `calendar-feed` | .ics feed of upcoming shifts. |

---

## 9. Deployment

### Frontend (Vercel)

- Auto-deploys from `main` branch
- Preview deployments for PR branches
- Build: `vite build` → `dist/`

### Backend (Supabase)

- Project: `esycmohgumryeqteiwla` (us-west-2)
- Migrations: `supabase/migrations/*.sql` — applied via `npx supabase db query --linked -f <file>`
- Edge functions: `npx supabase functions deploy <name>` (manual, not auto-deployed)

### Required Secrets

**GitHub Actions:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_VOLUNTEER_EMAIL`, `TEST_COORDINATOR_EMAIL`, `TEST_ADMIN_EMAIL`, `TEST_PASSWORD`

**Supabase Edge Functions:** `MAILERSEND_API_KEY` (or `RESEND_API_KEY`), `EMAIL_SANDBOX`, `EMAIL_SANDBOX_REDIRECT`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

---

## 10. Testing

### Unit + Integration (Vitest)

80 tests across 7 files:
- `parseShiftDate` — DST boundaries, leap years, timezone off-by-one
- Booking status transitions — state machine validation
- Consistency score — 90% threshold boundary tests
- `useUnreadCount` hook — single subscription, clean teardown

### E2E (Playwright)

5 browser-driving tests against production:
- Volunteer books shift + counter invariant
- Waitlist promotion lifecycle (A books → B waitlisted → A cancels → B promoted)
- Coordinator confirms attendance
- Admin hard-delete shift + orphan check
- Auto-cleanup of E2E test shifts using admin token

**CI:** 3-job pipeline (lint-and-unit → e2e → comment-on-pr). E2E uses `concurrency: e2e-playwright` to serialize runs against the shared DB.

---

## 11. Known Limitations

- **BulkComposeMessage:** Department filter not fully enforced (fixed in deferred audit PR)
- **SMS:** Twilio trial account requires verified recipient numbers
- **Email:** Currently in sandbox mode (`EMAIL_SANDBOX=true`) — all emails redirect to test inbox
- **No error monitoring:** No Sentry/LogRocket wired up
- **No data retention policy:** Messages, notifications accumulate indefinitely
- **Cloudflare Turnstile:** Currently disabled for CI E2E testing compatibility

---

## 12. Pre-Launch Checklist

- [ ] Disable `EMAIL_SANDBOX` and verify email delivery end-to-end
- [ ] Upgrade Twilio from trial to paid (removes verified-number restriction)
- [ ] Enable Cloudflare Turnstile captcha protection
- [ ] Wire Sentry for frontend + edge function error tracking
- [ ] Verify email sending domain DNS (SPF, DKIM, DMARC)
- [ ] Smoke test: full volunteer journey (register → activate → book → remind → confirm)
- [ ] Review Privacy Policy with Easterseals legal
- [ ] Enable Supabase paid-tier backups
- [ ] Load test against expected peak
- [ ] Document operational runbook for Easterseals staff

---

## 13. Directory Layout

```
easterseals-volunteer-scheduler/
├── .github/workflows/ci.yml
├── docs/
├── e2e/                          # Legacy REST-only Playwright tests
├── src/
│   ├── components/               # Shared (AppLayout, AppSidebar, MobileNav, NotificationBell, SlotSelectionDialog, etc.)
│   │   ├── messaging/            # ConversationList, ConversationThread, ComposeMessage
│   │   └── ui/                   # shadcn primitives (dialog, alert-dialog, sheet, etc.)
│   ├── contexts/AuthContext.tsx
│   ├── hooks/                    # useUnreadCount, use-mobile
│   ├── integrations/supabase/    # Generated client + types
│   ├── lib/                      # Pure utilities (calendar-utils, slot-utils, email-utils)
│   ├── pages/                    # 28 route pages
│   └── test/setup.ts
├── supabase/
│   ├── config.toml
│   ├── functions/                # 8 edge functions
│   └── migrations/               # 60+ SQL migrations
├── tests/e2e/                    # Browser-driving Playwright tests
│   ├── fixtures/                 # session.ts, db.ts helpers
│   └── *.spec.ts                 # 4 spec files
├── package.json
├── tailwind.config.ts
├── vitest.config.ts
└── index.html
```

---

*End of technical specification.*
