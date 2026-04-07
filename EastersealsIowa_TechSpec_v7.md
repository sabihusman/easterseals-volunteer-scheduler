# Easterseals Iowa Volunteer Scheduler — Technical Specification v7

**Version:** 7.0
**Date:** April 7, 2026
**Repository:** github.com/sabihusman/easterseals-volunteer-scheduler
**Live URL:** easterseals-volunteer-scheduler.vercel.app
**Supabase Project:** esycmohgumryeqteiwla.supabase.co
**Android Package:** org.eastersealsIowa.volunteerScheduler
**WordPress Landing:** easterseals-volunteer.local (LocalWP)

---

## What's New in v7

- **Reports tab** — analytics dashboard for coordinators/admins (popularity, ratings, attendance)
- **3 new SQL functions** for report data: `get_shift_popularity`, `get_shift_consistency`, `get_department_report`
- **Privacy hardening** — coordinator read access to individual `star_rating` and `shift_feedback` REVOKED at DB level; aggregate-only access via SECURITY DEFINER RPCs
- **Safe view** `volunteer_shift_reports_safe` for coordinator hours reconciliation
- **Custom DatePicker / TimePicker** components replacing native HTML5 inputs
- **Time range filter** on Browse Shifts (1w / 2w / 3w / 1m) gated by extended-booking eligibility
- **Eligibility banner** showing volunteer's consistency score and booking window
- **Auto-recalc trigger** for consistency score on every booking confirmation
- **Aggregate shift ratings** require ≥2 volunteer ratings before display
- **Shift delete cascade fixes** — recurrence FK is `SET NULL`, bookings/slots/interactions cascade
- **ShiftHistory same-day fix** + better CSV export with hours columns
- **Password reset Turnstile fix** — was failing with captcha verification error

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Database Schema](#2-database-schema)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Feature Inventory](#4-feature-inventory)
5. [Reports System](#5-reports-system)
6. [Messaging System](#6-messaging-system)
7. [Document Management](#7-document-management)
8. [Recommendation Engine](#8-recommendation-engine)
9. [Notification System](#9-notification-system)
10. [Points & Leaderboard](#10-points--leaderboard)
11. [Volunteer Hours Letter](#11-volunteer-hours-letter)
12. [Calendar Subscription](#12-calendar-subscription)
13. [Analytics (GA4)](#13-analytics-ga4)
14. [PWA Configuration](#14-pwa-configuration)
15. [Android TWA App](#15-android-twa-app)
16. [WordPress Landing Page](#16-wordpress-landing-page)
17. [Security Hardening](#17-security-hardening)
18. [CI/CD & Deployment](#18-cicd--deployment)
19. [Codebase Metrics](#19-codebase-metrics)
20. [Known Limitations & Future Work](#20-known-limitations--future-work)

---

## 1. System Architecture

### 1.1 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 18.3.1 |
| **Language** | TypeScript | 5.8.3 |
| **Build** | Vite | 5.4.19 |
| **CSS** | Tailwind CSS | 3.4.17 |
| **UI** | shadcn/ui (Radix UI) | Latest |
| **Routing** | React Router | 6.30.1 |
| **Server State** | TanStack React Query | 5.83.0 |
| **Forms** | React Hook Form + Zod | 7.61.1 / 3.25.76 |
| **Charts** | Recharts | 2.15.4 |
| **Dates** | date-fns | 3.6.0 |
| **Toasts** | Sonner | 1.7.4 |
| **Theme** | next-themes | 0.3.0 |
| **Bot Protection** | Cloudflare Turnstile | @marsidev/react-turnstile |
| **Backend** | Supabase (PostgreSQL 15) | 2.100.1 |
| **Auth** | Supabase Auth + MFA (TOTP) | Built-in |
| **Storage** | Supabase Storage | Built-in |
| **Real-time** | Supabase Realtime | Built-in |
| **Email** | Resend (via Edge Function + Supabase SMTP) | Edge Function |
| **SMS** | Twilio (via Edge Function) | Edge Function |
| **Analytics** | Google Analytics 4 | gtag.js |
| **Hosting** | Vercel | Auto-deploy |
| **CI/CD** | GitHub Actions | Workflow |
| **PWA** | vite-plugin-pwa + Workbox | 1.2.0 |
| **Android TWA** | Bubblewrap CLI | 1.24.1 |
| **JDK** | Microsoft OpenJDK | 17.0.18 |
| **Node** | Node LTS | 20.20.2 |
| **Landing Page** | WordPress 6.9.4 (LocalWP) | Custom theme |

### 1.2 Architecture Diagram

```
                    +---------------------------+
                    |    Vercel CDN / Hosting    |
                    +-------------+-------------+
                                  |
                  +---------------v---------------+
                  |   React SPA (PWA + Web)        |
                  |   Service Worker (Workbox)     |
                  |   Turnstile + MFA + GA4        |
                  +-+----------+----------+--------+
                    |          |          |
        +-----------+          |          +----------+
        |                      |                     |
+-------v-------+   +----------v---------+   +-------v-------+
| Web Browser   |   | Android TWA App     |   | Mobile PWA    |
| (any device)  |   | (Google Play Store) |   | (Add to Home) |
+-------+-------+   +----------+----------+   +-------+-------+
        |                      |                     |
        +----------+-----------+-------------+-------+
                   |                         |
        +----------v-----------+   +---------v---------+
        |  Supabase Backend     |   | Cloudflare        |
        |  - Auth + MFA         |   | Turnstile         |
        |  - PostgreSQL         |   +-------------------+
        |  - Realtime           |
        |  - Storage (2 buckets)|
        |  - Edge Functions (7) |
        +----+-------+--------+-+
             |       |        |
        +----v---+ +-v----+ +-v---------+
        | Resend | |Twilio| | pg_cron   |
        | (Email)| | (SMS)| | (4 jobs)  |
        +--------+ +------+ +-----------+
```

### 1.3 Project Structure

```
easterseals-volunteer-scheduler/
  src/
    App.tsx                              # Router + ProtectedRoute + providers
    main.tsx                             # Entry + ThemeProvider + TWA detection
    contexts/AuthContext.tsx              # Session, user, profile, role
    pages/                               # 28 page components
      Reports.tsx                        # NEW: coordinator/admin analytics dashboard
      MfaVerify.tsx                      # MFA TOTP verification
      PrivacyPolicy.tsx                  # Public privacy policy
    components/                          # 34 custom + 53 shadcn/ui
      messaging/                         #   6 messaging components
      DatePicker.tsx                     #   NEW: shadcn Calendar in popover
      TimePicker.tsx                     #   NEW: hour/minute/AM-PM select trio
      Avatar.tsx
      VolunteerLeaderboard.tsx
      VolunteerImpactCharts.tsx
      VolunteerHoursLetter.tsx
      VolunteerReliabilityBadge.tsx
      RecommendedShifts.tsx
      DocumentStatusBadge.tsx
      ui/                                #   53 shadcn/ui primitives
    hooks/                               # 5 custom hooks
    integrations/supabase/
      client.ts
      types.ts                           # Auto-generated DB types
    lib/
      analytics.ts                       # GA4 trackEvent
      calendar-utils.ts                  # ICS/CSV export, date helpers
      email-utils.ts
      slot-utils.ts
  public/
    .well-known/assetlinks.json          # Digital Asset Links (TWA verification)
    icon-192.png, icon-512.png           # PWA icons (maskable)
  supabase/
    migrations/                          # 20 SQL migration files
    functions/                           # 7 Edge Functions
      admin-act-on-behalf/index.ts
      admin-reset-mfa/index.ts
      calendar-feed/index.ts
      delete-user/index.ts
      notification-webhook/index.ts
      send-email/index.ts
      send-sms/index.ts
  android/                               # Bubblewrap-generated TWA project
  docs/
    play-store-listing.md
    sprint4-android-setup.md
  .github/workflows/
    android.yml                          # CI workflow for AAB builds
  index.html                             # SPA entry + GA4 gtag
  vite.config.ts                         # Vite + PWA plugin
  vercel.json                            # SPA rewrites + assetlinks headers
```

---

## 2. Database Schema

### 2.1 Entity Overview

**28 tables**, **2 views** (added `volunteer_shift_reports_safe`), **20 functions**, **9 triggers**, **4 pg_cron jobs**, **20 SQL migration files**.

#### Core Domain Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User accounts | full_name, email, phone, role, bg_check_status, total_hours, consistency_score, volunteer_points, avatar_url, calendar_token, onboarding_complete, emergency_contact_*, notif_*, extended_booking |
| `departments` | Volunteer departments | name, description, location_id, requires_bg_check, allows_groups, min_age, is_active |
| `locations` | Physical locations | name, address, city, state, timezone |
| `shifts` | Shift definitions | title, shift_date, start_time, end_time, department_id, total_slots, booked_slots, status, requires_bg_check, recurrence_parent |
| `shift_bookings` | Volunteer signups | shift_id, volunteer_id, booking_status, confirmation_status, final_hours, hours_source |
| `shift_time_slots` | 2-hour slot breakdown | shift_id, slot_start, slot_end, total_slots, booked_slots |
| `shift_booking_slots` | Booking-to-slot M:N | booking_id, slot_id |

#### Shift Lifecycle

| Table | Purpose |
|-------|---------|
| `shift_recurrence_rules` | Recurring patterns |
| `shift_notes` | Coordinator notes |
| `shift_attachments` | Files attached to notes |
| `shift_invitations` | Invite-a-friend tokens |
| `volunteer_shift_reports` | Self-confirmation: hours, star_rating, feedback (RLS: volunteer-only after v6.1) |
| `volunteer_shift_reports_safe` (view) | Sanitized view exposing only status + hours for coordinators |
| `confirmation_reminders` | Escalation tracking |

#### Recommendation Engine

| Table | Purpose |
|-------|---------|
| `volunteer_shift_interactions` | viewed/signed_up/cancelled/completed/no_show |
| `volunteer_preferences` | Affinity scores per dept/day/time |
| `shift_fill_rates` (view) | Calculated fill ratios |

#### Messaging

| Table | Purpose |
|-------|---------|
| `conversations` | Subject, type (direct/bulk), department_id |
| `conversation_participants` | last_read_at, is_archived |
| `messages` | Realtime via Supabase Realtime |

#### Documents

| Table | Purpose |
|-------|---------|
| `document_types` | name, is_required, has_expiry, expiry_days |
| `volunteer_documents` | Status (pending_review/approved/rejected/expired), expires_at |

#### Supporting

| Table | Purpose |
|-------|---------|
| `notifications` | In-app + webhook trigger for email/SMS |
| `events` | Community events |
| `event_registrations` | RSVPs |
| `department_coordinators` | Coordinator-to-department mapping |
| `department_restrictions` | Blocked volunteer-department pairs |
| `volunteer_private_notes` | Volunteer-only private notes |
| `admin_action_log` | Audit log for act-on-behalf |

### 2.2 Database Functions (20)

| Function | Purpose |
|----------|---------|
| `score_shifts_for_volunteer(uuid, int)` | Recommendation scoring with log-scale novelty |
| `is_admin()` / `is_coordinator_or_admin()` / `my_role()` | RLS helpers |
| `recalculate_consistency(uuid)` | Updates score, flips extended_booking ≥90% |
| `update_volunteer_preferences(uuid)` | Syncs affinity from interactions |
| `resolve_hours_discrepancy(uuid)` | Resolves volunteer vs coord hours |
| `transfer_admin_role(uuid, uuid)` | Transfers admin privileges |
| `export_critical_data()` | Full data export |
| `expire_documents()` | Daily expire pass (pg_cron) |
| `warn_expiring_documents()` | 30-day warnings (pg_cron) |
| `validate_booking_slot_count()` | Anti-overbooking with `FOR UPDATE` row lock |
| `enforce_bulk_conversation_limit()` | Max 2 participants on bulk |
| `cascade_bg_check_expiry()` | Cancels future BG-required bookings on expiry |
| `notify_email_on_notification()` | Calls notification-webhook |
| `recalculate_points(uuid)` | Hours-based points |
| `trg_recalculate_points_fn()` | Trigger handler with state delta detection |
| `trg_recalculate_consistency_fn()` | Auto-recalc consistency on booking change |
| **`get_shift_rating_aggregates(uuid[])`** | **Aggregate ratings (2+ minimum, SECURITY DEFINER)** |
| **`get_shift_popularity(uuid[])`** | **Popularity score: fill rate + waitlist demand + views** |
| **`get_shift_consistency(uuid[])`** | **Per-shift attendance rate** |
| **`get_department_report(uuid[], date, date)`** | **Department-level rollup with all metrics** |

### 2.3 Triggers (9)

| Trigger | Table | Event | Action |
|---------|-------|-------|--------|
| `trg_interaction_update_preferences` | volunteer_shift_interactions | INSERT | Updates affinity |
| `trg_email_on_notification` | notifications | INSERT (ALWAYS) | Calls webhook |
| `trg_enforce_bulk_limit` | conversation_participants | INSERT | Blocks 3+ on bulk |
| `trg_validate_booking_slots` | shift_bookings | INSERT (confirmed) | Validates slot count |
| `trg_validate_booking_slots_update` | shift_bookings | UPDATE → confirmed | Validates on transition |
| `trg_cascade_bg_check_expiry` | profiles | UPDATE bg_check_status | Cancels future + waitlisted |
| `trg_recalculate_points_*` | shift_bookings | UPDATE/DELETE | Points delta |
| `trg_recalculate_consistency` | shift_bookings | UPDATE confirmation_status | Auto consistency recalc |
| `trg_recalculate_consistency_delete` | shift_bookings | DELETE | Recalc on removal |

### 2.4 Scheduled Jobs (pg_cron)

| Job | Schedule (UTC) | Iowa Time | Function |
|-----|---------------|-----------|----------|
| `expire-documents-daily` | 7:00 AM | ~2 AM CDT | `expire_documents()` |
| `warn-expiring-documents-daily` | 1:00 PM | ~8 AM CDT | `warn_expiring_documents()` |
| `shift-reminder-24h` | Every hour at :00 | — | 24h reminders |
| `shift-reminder-2h` | Every hour at :30 | — | 2h reminders |

### 2.5 Foreign Key Cascades (post-v6 fix)

| Constraint | Behavior |
|-----------|----------|
| `shifts_recurrence_parent_fkey` | ON DELETE SET NULL |
| `shift_bookings_shift_id_fkey` | ON DELETE CASCADE |
| `shift_time_slots_shift_id_fkey` | ON DELETE CASCADE |
| `volunteer_shift_interactions_shift_id_fkey` | ON DELETE CASCADE |

### 2.6 Storage Buckets

| Bucket | Access | Path Convention |
|--------|--------|-----------------|
| `shift-attachments` | Coord/admin upload, authenticated read | `{userId}/{filename}` |
| `volunteer-documents` | Volunteer: own folder. Staff: read all. Avatars at `avatars/{userId}/avatar.{ext}` | `{userId}/{docTypeId}/{timestamp}.{ext}` |

---

## 3. Authentication & Authorization

### 3.1 Auth Methods

- **Email/password** with Cloudflare Turnstile
- **Google OAuth**
- **MFA/TOTP** (optional, enrolled in Settings)
- **Admin MFA reset** via `admin-reset-mfa` Edge Function
- **Password reset** via Supabase Auth + Resend SMTP — Turnstile enabled on forgot password forms (fixed in v6.1)

### 3.2 Role-Based Route Protection

| Route Pattern | Required Role |
|---------------|--------------|
| `/dashboard`, `/shifts`, `/history`, `/notes`, `/documents` | volunteer |
| `/coordinator/*`, `/reports` | coordinator or admin |
| `/admin/*` | admin |
| `/messages`, `/settings`, `/events` | any authenticated |
| `/auth`, `/forgot-password`, `/reset-password`, `/mfa-verify`, `/privacy` | public |

### 3.3 RLS Patterns

| Pattern | Implementation |
|---------|---------------|
| Own-data | `volunteer_id = auth.uid()` |
| Role escalation | `is_admin()` / `is_coordinator_or_admin()` |
| Conversation access | EXISTS on participants with `is_archived = false` |
| Private notes | Strict `volunteer_id = auth.uid()` (no admin override) |
| **Shift ratings/feedback** | **Volunteer-only direct read; coordinators access only via `get_shift_rating_aggregates()` RPC** |
| Storage scoping | `(storage.foldername(name))[1] = auth.uid()::text` |
| Admin audit | `admin_action_log` records all impersonation |

---

## 4. Feature Inventory

### 4.1 Volunteer Features (28 pages total)

| Feature | Description |
|---------|-------------|
| Dashboard | Upcoming shifts, hours, points, milestones |
| Browse Shifts | Sorted by date+time, dept filter, **time range filter (1w/2w/3w/1m, gated by eligibility)**, **eligibility banner** |
| Shift History | Past shifts (incl. same-day completed), CSV export with hours columns |
| Hours Letter | PDF with letterhead + admin signature |
| Shift Confirmation | Self-report hours, rate, feedback, private note → My Notes |
| Impact Charts | Hours/month + confirmed vs no-shows |
| Private Notes | Shift-linked, auto-lock, PDF export |
| Documents | Upload required documents |
| Messaging | Real-time threads with coordinators |
| Events | Community event RSVPs |
| Settings | Profile, MFA, theme, notifications, calendar sync, avatar upload |

### 4.2 Coordinator Features

- Department dashboard
- Manage shifts (CRUD, recurring, deletion with booking cancellation warning)
- Hours confirmation override (via safe view)
- **Reports tab — full analytics dashboard (department-scoped)**
- Direct + bulk messaging
- Volunteer activity view (with aggregate ratings only)

### 4.3 Admin Features

- Admin Dashboard with leaderboard
- User management (roles, BG checks, activation)
- **Act-on-behalf** (book/cancel/confirm/update with audit log)
- **MFA reset** for locked-out users
- Department/Event/Reminder management
- Document Types definition
- Compliance dashboard
- Bulk messaging (filter by dept/BG)
- **Reports tab — full org-wide analytics dashboard**

---

## 5. Reports System

### 5.1 Page: `/reports` (NEW)

Accessible to coordinators and admins. Coordinators see only their own departments (filtered via `department_coordinators`). Admins see everything.

### 5.2 Filters

- Department (single-select, defaults to "All")
- Date range (DatePicker for "from" and "to", defaults to last 30 days)

### 5.3 Summary Cards

| Card | Calculation |
|------|------------|
| Total Shifts | Count of shifts in range |
| Fill Rate | Σ confirmed / Σ total slots × 100% |
| Attendance | attended / (attended + no_shows) × 100% |
| Avg Rating | Average of `get_shift_rating_aggregates()` results |

### 5.4 Tabs

#### Overview Tab
- **Outcome breakdown pie chart** — attended / no-show / cancelled / waitlisted
- **Department rollup** — per-department metrics from `get_department_report()`

#### Popularity Tab
- **Top 10 most popular shifts** — Recharts horizontal bar chart
- **Popularity score formula:**
  ```
  fill_rate × 1.0 + waitlist_count × 0.1 + min(views/20, 1.0) × 0.2
  ```
- **Detail list** showing fill ratio and waitlist count

#### Ratings Tab
- **Top 10 highest-rated shifts** — Recharts horizontal bar
- **Privacy enforced:** only shifts with **2+ ratings** appear (DB-level via `get_shift_rating_aggregates()`)

#### Attendance Tab
- **Lowest attendance rate** (min 3 bookings) — for identifying problem time slots
- Color-coded badge: green ≥80%, red <80%
- Shows attended/total + no-show count

### 5.5 CSV Export

Per-shift export with all metrics:
Date, Shift, Department, Total Slots, Confirmed, Waitlisted, Views, Fill %, Attended, No Shows, Cancelled, Attendance Rate %, Popularity Score, Avg Rating, Rating Count

### 5.6 SQL Functions Backing the Reports

| Function | Returns | Privacy |
|----------|---------|---------|
| `get_shift_popularity(uuid[])` | confirmed_count, waitlist_count, view_count, fill_ratio, popularity_score | Coord/admin only |
| `get_shift_consistency(uuid[])` | total_bookings, attended, no_shows, cancelled, attendance_rate | Coord/admin only |
| `get_shift_rating_aggregates(uuid[])` | avg_rating, rating_count | Coord/admin only, **2+ minimum** |
| `get_department_report(uuid[], date, date)` | All dept-level metrics including avg_rating (still 2+ minimum per shift) | Coord/admin only |

All four are SECURITY DEFINER with `is_coordinator_or_admin()` gate.

---

## 6. Messaging System

- 1:1 conversations (direct) or per-recipient (bulk)
- Real-time via Supabase Realtime on `messages`
- Notifications trigger email + SMS via webhook
- Bulk: trigger enforces max 2 participants
- Sender names resolved via `messages.sender_id` (avoids RLS gap on `conversation_participants`)
- Archived participants blocked from read/write

---

## 7. Document Management

### Workflow

```
Admin defines doc types → Volunteer uploads → Pending review →
  Approve → Approved → expires_at passes → Expired → Re-upload
  Reject → Rejected → Re-upload
```

### Automation

- `expire_documents()` daily at 2 AM CDT
- `warn_expiring_documents()` daily at 8 AM CDT (30-day warning, weekly dedup)
- BG check expiry cascades to cancel future + waitlisted bookings on BG-required shifts
- Same-day shifts NOT cancelled (coordinator warned instead)

---

## 8. Recommendation Engine

```
final_score = preference_match × 0.5 + org_need × 0.3 + novelty × 0.2
```

- Booking window via `p_max_days` (14 standard / 21 extended)
- BG check status enforced
- Active volunteers not penalized (novelty floor 0.3)
- Auto-recalc trigger on booking confirmation (new in v7)

### Eligibility (Extended Booking)

- 90% consistency over rolling 5-shift window (minimum 5 shifts)
- Unlocked: 21-day booking window vs standard 14-day
- **Time range filter UI** locks "3 weeks" and "1 month" options for non-eligible volunteers
- **Eligibility banner** shows on Browse Shifts with current score and unlock criteria

---

## 9. Notification System

### Delivery Chain

```
INSERT into notifications
  → trg_email_on_notification (ALWAYS trigger)
  → notification-webhook
    → notif_email + category pref → send-email (Resend)
    → notif_sms + phone + category pref → send-sms (Twilio)
```

### Type Mapping

| Type | Category Pref |
|------|---------------|
| `shift_reminder` / `shift_reminder_auto` / `self_confirmation_reminder` | notif_shift_reminders |
| `new_message` | notif_new_messages |
| `hours_milestone` | notif_milestone |
| `document_expired` / `document_expiry_warning` | notif_document_expiry |
| `booking_confirmed` / `booking_cancelled` / `late_cancellation` / `waitlist_notification` | notif_booking_changes |
| `bg_check_status_change` | always sent |

---

## 10. Points & Leaderboard

### Points (Hours-Based)

| Action | Points |
|--------|--------|
| Per hour of confirmed completed shift | +10 (`final_hours × 10`) |
| Each 5-star rating | +5 |
| Each 10-hour milestone | +25 |

Trigger fires on state delta + DELETE.

### Leaderboard

- Top 10 by `volunteer_points`
- Tie-breaking: `points → consistency_score → created_at`
- Recharts horizontal bar with gold/silver/bronze top 3

---

## 11. Volunteer Hours Letter

- PDF letter with Easterseals letterhead
- Includes shifts where `confirmation_status = 'confirmed'` AND `final_hours IS NOT NULL` AND `shift_date <= today`
- Admin signature: oldest admin by `created_at`
- Browser print-to-PDF

---

## 12. Calendar Subscription

- Edge Function: `calendar-feed/index.ts`
- **Auth:** Long-lived `calendar_token` UUID (never expires)
- **Timezone:** Pulled from `locations.timezone` per shift
- Stable UIDs for calendar app deduplication
- `Cache-Control: no-store`

---

## 13. Analytics (GA4)

- Measurement ID: `G-X60LKSXMYR`
- gtag.js loaded conditionally
- `trackEvent(name, params)` utility — no PII

---

## 14. PWA Configuration

| Setting | Value |
|---------|-------|
| Display | standalone |
| Orientation | portrait |
| Theme color | #006B3E |
| Icons | 192/512 maskable |
| Short name | ESVolunteers |

### Caching

| Resource | Strategy | TTL |
|----------|----------|-----|
| Static assets | Precache | Build-versioned |
| Booking endpoints | NetworkOnly | No cache |
| Other Supabase API | NetworkFirst | 60s |
| Google Fonts | CacheFirst | 1 year |

---

## 15. Android TWA App

| Setting | Value |
|---------|-------|
| Tool | Bubblewrap CLI 1.24.1 |
| Package name | `org.eastersealsIowa.volunteerScheduler` |
| Min SDK | 21 |
| Target SDK | 34 |

### Status

- ✅ AAB built locally
- ⏳ Awaiting Google Play developer verification (1-2 weeks)
- ⏳ Manual upload after verification → SHA-256 → assetlinks.json

---

## 16. WordPress Landing Page

LocalWP custom theme with Easterseals Iowa branding (navy + burnt orange + green).

---

## 17. Security Hardening

### Cumulative Fixes

| Issue | Fix |
|-------|-----|
| Bot protection | Cloudflare Turnstile on login + signup + forgot password |
| MFA support | TOTP enrollment + verification + admin reset |
| Admin audit trail | `admin_action_log` for impersonation |
| Storage isolation | Volunteers scoped to `auth.uid()` folder |
| Messaging RLS | Checks `is_archived = false`; names via messages |
| Bulk conversation privacy | Trigger enforces max 2 participants |
| Private notes | Strict `volunteer_id = auth.uid()` |
| Document expiry | Automated via pg_cron |
| Overbooking | Trigger validates with `FOR UPDATE` row lock |
| BG cascade | Cancels future + waitlisted, skips same-day |
| Calendar auth | Long-lived UUID token |
| Cross-tab timeout | localStorage StorageEvent sync |
| PWA stale data | NetworkOnly for booking endpoints |
| Novelty bias | Log-scale with 0.3 floor |
| Points double-count | State delta check + DELETE handler |
| Hours letter same-day | Filter `<= today` |
| Admin signature | Deterministic ordering |
| Leaderboard ties | `points → consistency → created_at` |
| Resend click tracking | `data-resend-track="false"` on email links |
| WaitlistStatus / CoverageAlert | Fixed wrong column references |
| `/mfa-verify` timeout | Added to EXCLUDED_PATHS |
| AuthContext double fetch | Removed `getSession()` |
| BrowseShifts ShiftCard | Extracted to module-level component |
| OnboardingModal wasted query | Departments only when needed |
| Turnstile secret rotation | Rotated after exposure |
| Shift delete cascades | FK behaviors fixed |
| Password reset captcha | Turnstile added to forgot password forms |
| **Star rating privacy** | **DB-level enforcement: coord read REVOKED, aggregates only via SECURITY DEFINER RPC** |
| **2+ rating minimum** | **Enforced in SQL via `HAVING COUNT(*) >= 2`** |

### Credential Storage

| Secret | Location |
|--------|----------|
| Supabase URL + anon key | Vercel env vars |
| Resend API key | Supabase Edge Function secret + Auth SMTP |
| Twilio SID/Auth/Phone | Supabase Edge Function secrets |
| Turnstile site key | Vercel (`VITE_TURNSTILE_SITE_KEY`) |
| Turnstile secret key | Supabase secret + Auth Bot Protection |
| GA4 Measurement ID | Vercel (`VITE_GA_MEASUREMENT_ID`) |
| Android keystore | Local file (gitignored) + GitHub secrets (base64) |

---

## 18. CI/CD & Deployment

### Web Pipeline

```
Push to main → GitHub Actions CI → Vercel auto-deploy → SW auto-update
```

### SQL Migrations

Applied directly via linked Supabase CLI:
```bash
npx supabase db query --linked --file supabase/migrations/<filename>.sql
```

### Edge Function Deployment

```bash
npx supabase functions deploy <name> --project-ref esycmohgumryeqteiwla
```

7 deployed: send-email, send-sms, notification-webhook, delete-user, admin-act-on-behalf, calendar-feed, admin-reset-mfa

### Android Pipeline

```
Local: bubblewrap build → app-release-bundle.aab
  OR
git tag android-v1.0.0 → push → GitHub Actions → AAB artifact
```

---

## 19. Codebase Metrics

| Metric | Count |
|--------|-------|
| Source files (.ts/.tsx) | 131 |
| Page components | 28 |
| Custom components (non-UI) | 34 |
| shadcn/ui components | 53 |
| Custom hooks | 5 |
| Database tables | 28 |
| Database views | 2 |
| Database functions | 20 |
| Database triggers | 9 |
| pg_cron jobs | 4 |
| SQL migrations | 20 |
| Edge Functions | 7 |
| Storage buckets | 2 |
| Git commits | 90+ |
| Bugs fixed (audits) | 30+ |
| Sprints completed | 4 of 4 |

---

## 20. Known Limitations & Future Work

### Current Limitations

| Item | Notes |
|------|-------|
| Google Play developer verification | Required before AAB upload (1-2 weeks address verification) |
| Twilio trial | Only verified numbers receive SMS until upgrade |
| Resend domain verification | Needed for non-admin email delivery beyond sandbox |
| Landing page hosting | LocalWP only |
| Bundle size | ~940KB main chunk |
| Closed test (12 testers × 14 days) | Required by Play Console before production |

### Future Enhancements

- Code splitting (`React.lazy` + `Suspense`)
- Web Push notifications
- Two-way Google Calendar sync
- Multi-language (i18n)
- Audit log viewer in admin UI
- MFA recovery codes UX
- Time-series trend charts in Reports tab (e.g., fill rate over time)
- Volunteer-level reports (top contributors, retention curves)

---

*Generated April 7, 2026 — Easterseals Iowa Volunteer Scheduler v7.0 (post Reports tab)*
