# Easterseals Iowa Volunteer Scheduler — Technical Specification v6

**Version:** 6.0
**Date:** April 7, 2026
**Repository:** github.com/sabihusman/easterseals-volunteer-scheduler
**Live URL:** easterseals-volunteer-scheduler.vercel.app
**Supabase Project:** esycmohgumryeqteiwla.supabase.co
**Android Package:** org.eastersealsIowa.volunteerScheduler
**WordPress Landing:** easterseals-volunteer.local (LocalWP)

---

## What's New in v6

- **Sprint 4 — Android TWA app** built and signed via Bubblewrap CLI
- **6 Edge Functions** total (added `admin-reset-mfa`)
- **Privacy Policy page** deployed at `/privacy` (Play Store requirement)
- **GitHub Actions workflow** for automated AAB builds on tag push
- **Digital Asset Links** (`.well-known/assetlinks.json`) for TWA verification
- **TWA context detection** in `main.tsx`
- **Turnstile secret rotation** documented and applied
- **All 12 v5 audit bugs** fixed (messaging RLS, points triggers, BG cascade, etc.)

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Database Schema](#2-database-schema)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Feature Inventory](#4-feature-inventory)
5. [Messaging System](#5-messaging-system)
6. [Document Management](#6-document-management)
7. [Recommendation Engine](#7-recommendation-engine)
8. [Notification System](#8-notification-system)
9. [Points & Leaderboard](#9-points--leaderboard)
10. [Volunteer Hours Letter](#10-volunteer-hours-letter)
11. [Calendar Subscription](#11-calendar-subscription)
12. [Analytics (GA4)](#12-analytics-ga4)
13. [PWA Configuration](#13-pwa-configuration)
14. [Android TWA App](#14-android-twa-app)
15. [WordPress Landing Page](#15-wordpress-landing-page)
16. [Security Hardening](#16-security-hardening)
17. [CI/CD & Deployment](#17-cicd--deployment)
18. [Codebase Metrics](#18-codebase-metrics)
19. [Known Limitations & Future Work](#19-known-limitations--future-work)

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
| **Email** | Resend (via Edge Function) | Edge Function |
| **SMS** | Twilio (via Edge Function) | Edge Function |
| **Analytics** | Google Analytics 4 | gtag.js |
| **Hosting** | Vercel | Auto-deploy |
| **CI/CD** | GitHub Actions | Workflow |
| **PWA** | vite-plugin-pwa + Workbox | 1.2.0 |
| **Android TWA** | Bubblewrap CLI | 1.24.1 |
| **JDK** | Microsoft OpenJDK | 17.0.18 |
| **Landing Page** | WordPress 6.9.4 (LocalWP) | Custom theme |

### 1.2 Architecture Diagram

```
                    +---------------------------+
                    |    Vercel CDN / Hosting    |
                    |   (auto-deploy from Git)   |
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
        |  - Auth + MFA         |   | Turnstile (CAPTCHA)|
        |  - PostgreSQL (28 t.) |   +-------------------+
        |  - Realtime           |
        |  - Storage (2 buckets)|
        |  - Edge Functions (6) |
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
    pages/                               # 27 page components
      MfaVerify.tsx                       # MFA TOTP verification
      PrivacyPolicy.tsx                   # Privacy policy at /privacy
    components/                          # 32 custom + 53 shadcn/ui
      messaging/                         #   6 messaging components
      Avatar.tsx                         #   Reusable avatar
      VolunteerLeaderboard.tsx           #   Top 10 Recharts bar
      VolunteerImpactCharts.tsx          #   Hours/month + confirmed vs no-shows
      VolunteerHoursLetter.tsx           #   PDF letter generator
      VolunteerReliabilityBadge.tsx      #   Reliability tier badge
      RecommendedShifts.tsx              #   Smart recommendations
      DocumentStatusBadge.tsx            #   Document status badge
      ui/                                #   53 shadcn/ui primitives
    hooks/                               # 5 custom hooks
    integrations/supabase/
      client.ts                          #   Typed Supabase client
      types.ts                           #   Auto-generated DB types
    lib/
      analytics.ts                       #   GA4 trackEvent wrapper
      calendar-utils.ts                  #   ICS/CSV export, date helpers
      email-utils.ts                     #   Edge function email wrapper
      slot-utils.ts                      #   Time slot formatting
  public/
    .well-known/assetlinks.json          # Digital Asset Links (TWA verification)
    icon-192.png, icon-512.png           # PWA icons (maskable)
    apple-touch-icon.png                 # iOS icon
  supabase/
    migrations/                          # 16 SQL migration files
    functions/                           # 6 Edge Functions
      admin-act-on-behalf/index.ts       #   Admin impersonation + audit log
      admin-reset-mfa/index.ts           #   Admin removes MFA factors
      calendar-feed/index.ts             #   ICS calendar subscription
      delete-user/index.ts               #   Account deletion
      notification-webhook/index.ts      #   Routes notifications to email/SMS
      send-email/index.ts                #   Resend email delivery
      send-sms/index.ts                  #   Twilio SMS delivery
  android/                               # Bubblewrap-generated TWA project
    twa-manifest.json                    #   App manifest
    android.keystore                     #   Signing key (gitignored)
    app-release-bundle.aab               #   Built bundle for Play Store
    app-release-signed.apk               #   Signed APK for sideload testing
  docs/
    play-store-listing.md                # Play Store listing copy + checklist
    sprint4-android-setup.md             # Manual setup guide
  .github/workflows/
    android.yml                          # CI workflow for AAB builds
  index.html                             # SPA entry + GA4 gtag
  vite.config.ts                         # Vite + PWA plugin config
  vercel.json                            # SPA rewrites + assetlinks headers
```

---

## 2. Database Schema

### 2.1 Entity Overview

The database contains **28 tables**, **1 view**, **17 functions**, **7 triggers**, and **4 pg_cron scheduled jobs**. Total of **16 SQL migration files**.

#### Core Domain Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User accounts | full_name, email, phone, role, bg_check_status, total_hours, consistency_score, volunteer_points, avatar_url, calendar_token, onboarding_complete, emergency_contact_*, notif_email/in_app/sms, notif_shift_reminders/new_messages/milestone/document_expiry/booking_changes |
| `departments` | Volunteer departments | name, description, location_id, requires_bg_check, allows_groups, min_age, is_active |
| `locations` | Physical locations | name, address, city, state, timezone |
| `shifts` | Shift definitions | title, shift_date, start_time, end_time, department_id, total_slots, booked_slots, status, requires_bg_check, is_recurring, coordinator_note |
| `shift_bookings` | Volunteer signups | shift_id, volunteer_id, booking_status, confirmation_status, final_hours, hours_source |
| `shift_time_slots` | 2-hour slot breakdown | shift_id, slot_start, slot_end, total_slots, booked_slots |
| `shift_booking_slots` | Booking-to-slot M:N | booking_id, slot_id |

#### Shift Lifecycle Tables

| Table | Purpose |
|-------|---------|
| `shift_recurrence_rules` | Recurring shift patterns |
| `shift_notes` | Coordinator notes on bookings |
| `shift_attachments` | Files attached to shift notes |
| `shift_invitations` | Invite-a-friend tokens |
| `volunteer_shift_reports` | Self-confirmation: hours, star_rating, feedback |
| `confirmation_reminders` | Escalation tracking |

#### Recommendation Engine Tables

| Table | Purpose |
|-------|---------|
| `volunteer_shift_interactions` | Tracks viewed/signed_up/cancelled/completed/no_show |
| `volunteer_preferences` | Affinity scores per department/day/time |
| `shift_fill_rates` (view) | Calculated fill ratios |

#### Messaging Tables

| Table | Purpose |
|-------|---------|
| `conversations` | Thread metadata: subject, type (direct/bulk), department_id |
| `conversation_participants` | Membership: last_read_at, is_archived |
| `messages` | Real-time content via Supabase Realtime |

#### Document Management Tables

| Table | Purpose |
|-------|---------|
| `document_types` | Admin-defined: name, is_required, has_expiry, expiry_days |
| `volunteer_documents` | Uploads: status, expires_at |

#### Supporting Tables

| Table | Purpose |
|-------|---------|
| `notifications` | In-app + webhook trigger for email/SMS, includes data jsonb |
| `events` | Community events |
| `event_registrations` | Volunteer event RSVPs |
| `department_coordinators` | Coordinator-to-department mapping |
| `department_restrictions` | Blocked volunteer-department pairs |
| `volunteer_private_notes` | Volunteer-only private notes (no admin access) |
| `admin_action_log` | Audit log for act-on-behalf actions |

### 2.2 Database Functions (17)

| Function | Purpose |
|----------|---------|
| `score_shifts_for_volunteer(uuid, int)` | Recommendation scoring with log-scale novelty floor |
| `is_admin()` / `is_coordinator_or_admin()` / `my_role()` | RLS helpers |
| `recalculate_consistency(uuid)` | Updates reliability score |
| `update_volunteer_preferences(uuid)` | Syncs affinity from interactions |
| `resolve_hours_discrepancy(uuid)` | Resolves volunteer vs coordinator hours |
| `transfer_admin_role(uuid, uuid)` | Transfers admin privileges |
| `export_critical_data()` | Full data export |
| `expire_documents()` | Daily expire pass (pg_cron) |
| `warn_expiring_documents()` | 30-day warnings (pg_cron) |
| `validate_booking_slot_count()` | Anti-overbooking with row lock |
| `enforce_bulk_conversation_limit()` | Max 2 participants on bulk |
| `cascade_bg_check_expiry()` | Cancels future BG-required bookings |
| `notify_email_on_notification()` | Calls notification-webhook |
| `recalculate_points(uuid)` | Hours-based points: `final_hours * 10` + ratings + milestones |
| `trg_recalculate_points_fn()` | Trigger handler with delta detection |

### 2.3 Triggers (7)

| Trigger | Table | Event | Action |
|---------|-------|-------|--------|
| `trg_interaction_update_preferences` | volunteer_shift_interactions | INSERT | Updates affinity scores |
| `trg_email_on_notification` | notifications | INSERT (ALWAYS) | Calls notification-webhook |
| `trg_enforce_bulk_limit` | conversation_participants | INSERT | Blocks 3+ on bulk |
| `trg_validate_booking_slots` | shift_bookings | INSERT (confirmed) | Validates slot count |
| `trg_validate_booking_slots_update` | shift_bookings | UPDATE → confirmed | Validates on status change |
| `trg_cascade_bg_check_expiry` | profiles | UPDATE bg_check_status | Cancels future + waitlisted |
| `trg_recalculate_points_*` | shift_bookings | UPDATE/DELETE | Points delta with state check |

### 2.4 Scheduled Jobs (pg_cron)

| Job | Schedule (UTC) | Iowa Time | Function |
|-----|---------------|-----------|----------|
| `expire-documents-daily` | 7:00 AM | ~2 AM CDT | `expire_documents()` |
| `warn-expiring-documents-daily` | 1:00 PM | ~8 AM CDT | `warn_expiring_documents()` |
| `shift-reminder-24h` | Every hour at :00 | — | 24h shift reminders |
| `shift-reminder-2h` | Every hour at :30 | — | 2h shift reminders |

### 2.5 Storage Buckets

| Bucket | Access | Path Convention |
|--------|--------|-----------------|
| `shift-attachments` | Coordinator/admin upload, authenticated read | `{userId}/{filename}` |
| `volunteer-documents` | Volunteer: own folder. Staff: read all. Avatars at `avatars/{userId}/avatar.{ext}` | `{userId}/{docTypeId}/{timestamp}.{ext}` |

---

## 3. Authentication & Authorization

### 3.1 Auth Methods

- **Email/password** with Cloudflare Turnstile bot protection
- **Google OAuth** as alternative provider
- **MFA/TOTP** (optional, enrolled in Settings → Security)
- **Admin MFA reset** via `admin-reset-mfa` Edge Function for lockout recovery

### 3.2 MFA Flow

```
Login → captchaToken from Turnstile → Supabase signInWithPassword
  → If MFA enrolled: redirect to /mfa-verify
    → User enters 6-digit code → challengeAndVerify() → /dashboard
  → If no MFA: → /dashboard
```

### 3.3 Role-Based Route Protection

| Route Pattern | Required Role |
|---------------|--------------|
| `/dashboard`, `/shifts`, `/history`, `/notes`, `/documents` | volunteer |
| `/coordinator/*` | coordinator or admin |
| `/admin/*` | admin |
| `/messages`, `/settings`, `/events` | any authenticated |
| `/auth`, `/forgot-password`, `/reset-password`, `/mfa-verify`, `/privacy` | public |

### 3.4 RLS Patterns

| Pattern | Implementation |
|---------|---------------|
| Own-data | `volunteer_id = auth.uid()` |
| Role escalation | `public.is_admin()` / `public.is_coordinator_or_admin()` |
| Conversation access | EXISTS on participants with `is_archived = false` |
| Private notes | Strict `volunteer_id = auth.uid()` (no admin override) |
| Storage scoping | `(storage.foldername(name))[1] = auth.uid()::text` |
| Admin audit | `admin_action_log` records all impersonation actions |

---

## 4. Feature Inventory

### 4.1 Volunteer Features (27 pages)

| Feature | Description |
|---------|-------------|
| Dashboard | Upcoming shifts, hours, points, milestones |
| Browse Shifts | Search/filter + smart recommendations |
| Shift History | Past shifts, hours breakdown, CSV export |
| Hours Letter | PDF with Easterseals letterhead + admin signature |
| Shift Confirmation | Self-report hours, rate, feedback |
| Impact Charts | Hours/month + confirmed vs no-shows |
| Private Notes | Shift-linked, auto-lock, PDF export |
| Documents | Upload required documents, status tracking |
| Messaging | Real-time 1:1 threads with coordinators |
| Events | Community event RSVPs |
| Settings | Profile, MFA, theme, notifications, calendar sync |

### 4.2 Coordinator Features

- Department dashboard
- Manage shifts (create/edit/cancel/recurring)
- Hours confirmation override
- Direct + bulk messaging
- Volunteer activity view

### 4.3 Admin Features

- Admin Dashboard with leaderboard
- User management (roles, BG checks, activation)
- **Act-on-behalf** (book/cancel/confirm/update with audit log)
- **MFA reset** for locked-out users
- Department/Event/Reminder management
- Document Types definition
- Compliance dashboard
- Bulk messaging (filter by department/BG)

---

## 5. Messaging System

- **Model:** 1 conversation per user pair (direct) or per recipient (bulk)
- **Real-time:** Supabase Realtime subscription on `messages`
- **Notifications:** Triggers email + SMS via webhook (respects category prefs)
- **Bulk:** Trigger enforces max 2 participants (privacy-safe individual threads)
- **Sender names:** Resolved via `messages.sender_id` lookup (avoids RLS gap on conversation_participants)
- **Archived participants:** Blocked from read/write via RLS

---

## 6. Document Management

### 6.1 Workflow

```
Admin defines doc types → Volunteer uploads → Pending review →
  Approve → Approved → (expires_at passes) → Expired → Re-upload
  Reject → Rejected → Re-upload
```

### 6.2 Automation

- `expire_documents()` daily at 2 AM CDT
- `warn_expiring_documents()` daily at 8 AM CDT (30-day warning, weekly dedup)
- BG check expiry cascades to cancel **future + waitlisted** bookings on BG-required shifts
- Same-day shifts NOT cancelled (coordinator warned instead)

---

## 7. Recommendation Engine

### 7.1 Scoring Formula

```
final_score = preference_match × 0.5 + org_need × 0.3 + novelty × 0.2
```

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Preference Match | 50% | Department affinity (0-100 → 0-1) |
| Organizational Need | 30% | `1.0 - (booked / total)` |
| Novelty | 20% | `max(1.0 - ln(1+interactions) / ln(1+50), 0.3)` |

### 7.2 Behaviors

- Booking window via `p_max_days` (14 standard / 21 BG-required)
- BG check status enforced
- Active volunteers not penalized (0.3 floor)

---

## 8. Notification System

### 8.1 Delivery Chain

```
INSERT into notifications
  → trg_email_on_notification (ALWAYS)
  → notification-webhook
    → notif_email + category pref → send-email (Resend)
    → notif_sms + phone + category pref → send-sms (Twilio)
```

### 8.2 Type Mapping (12 types)

| Type | Category Pref |
|------|---------------|
| `shift_reminder` / `shift_reminder_auto` / `self_confirmation_reminder` | notif_shift_reminders |
| `new_message` | notif_new_messages |
| `hours_milestone` | notif_milestone |
| `document_expired` / `document_expiry_warning` | notif_document_expiry |
| `booking_confirmed` / `booking_cancelled` / `late_cancellation` / `waitlist_notification` | notif_booking_changes |
| `bg_check_status_change` | always sent |

---

## 9. Points & Leaderboard

### 9.1 Points (Hours-Based)

| Action | Points |
|--------|--------|
| Per hour of confirmed completed shift | +10 (`final_hours × 10`) |
| Each 5-star rating | +5 |
| Each 10-hour milestone | +25 |

Trigger fires on **state delta** (`OLD != confirmed AND NEW = confirmed`) and on **DELETE** to prevent double-counting and stale data.

### 9.2 Leaderboard

- Top 10 volunteers
- **Deterministic tie-breaking:** `points → consistency_score → created_at`
- Recharts horizontal bar with gold/silver/bronze for top 3
- "Your rank" footer if user is outside top 10

---

## 10. Volunteer Hours Letter

- PDF letter with Easterseals letterhead
- Includes shifts where `confirmation_status = 'confirmed'` AND `final_hours IS NOT NULL` AND `shift_date <= today`
- Admin signature: oldest admin by `created_at` (deterministic)
- Browser print-to-PDF (no library)

---

## 11. Calendar Subscription

- Edge Function: `calendar-feed/index.ts`
- **Auth:** Long-lived `calendar_token` (UUID, never expires) — not JWT
- **Timezone:** Pulled dynamically from `locations.timezone` per shift
- Stable UIDs for calendar app deduplication
- `Cache-Control: no-store`

---

## 12. Analytics (GA4)

- Measurement ID: `G-X60LKSXMYR` (via `VITE_GA_MEASUREMENT_ID`)
- gtag.js loaded conditionally
- `trackEvent(name, params)` utility — no PII

---

## 13. PWA Configuration

| Setting | Value |
|---------|-------|
| Display | standalone |
| Orientation | portrait |
| Theme color | #006B3E |
| Icons | 192/512 maskable |
| Short name | ESVolunteers |
| Plugin | vite-plugin-pwa 1.2.0 |

### Caching

| Resource | Strategy | TTL |
|----------|----------|-----|
| Static assets | Precache | Build-versioned |
| Booking endpoints (`shifts`, `shift_bookings`, etc.) | **NetworkOnly** | No cache |
| Other Supabase API | NetworkFirst | 60s, 50 entries |
| Google Fonts | CacheFirst | 1 year |

---

## 14. Android TWA App

### 14.1 Setup

- **Tool:** Bubblewrap CLI 1.24.1
- **Package name:** `org.eastersealsIowa.volunteerScheduler`
- **App name:** Easterseals Iowa Volunteer Scheduler
- **Short name:** ESVolunteers
- **Min SDK:** 21 (Android 5.0+)
- **Target SDK:** 34
- **Signing:** Local keystore at `android/android.keystore` (gitignored)
- **Outputs:** `app-release-bundle.aab` (Play Store) + `app-release-signed.apk` (sideload)

### 14.2 Digital Asset Links

- File: `public/.well-known/assetlinks.json`
- Vercel headers config serves with `Content-Type: application/json`
- SHA-256 fingerprint placeholder until first Play Store upload
- After fingerprint added, Android removes browser address bar (TWA verified)

### 14.3 TWA Detection

```ts
// src/main.tsx
const isTWA = document.referrer.startsWith("android-app://");
if (isTWA) document.documentElement.classList.add("twa");
```

CSS can hide install prompts when running in the Android shell:
```css
.twa .pwa-install-banner { display: none; }
```

### 14.4 GitHub Actions Workflow

- File: `.github/workflows/android.yml`
- Triggers: `android-v*` tag push or manual workflow dispatch
- Restores keystore from base64 secret
- Builds AAB via Bubblewrap
- Uploads as GitHub artifact (30-day retention)

### 14.5 Required Secrets

| Secret | Location |
|--------|----------|
| `ANDROID_KEYSTORE_BASE64` | GitHub Actions |
| `ANDROID_KEYSTORE_PASSWORD` | GitHub Actions |
| `ANDROID_KEY_PASSWORD` | GitHub Actions |

### 14.6 Privacy Policy

- Page: `src/pages/PrivacyPolicy.tsx` at `/privacy` route
- Required by Play Store data safety section
- Covers: data collection, usage, sharing, rights, security, children, contact

---

## 15. WordPress Landing Page

### 15.1 Sections

1. Top bar (burnt orange #cf4b04)
2. Sticky header with logo + Volunteer Portal CTA
3. Split hero: orange + navy
4. Stats bar (4 gold counters)
5. How It Works (4 steps)
6. Departments (6 cards)
7. Features (2x2 grid with green dot accents)
8. CTA section
9. 4-column footer

### 15.2 Colors

| Name | Hex |
|------|-----|
| Navy | #1B2A4A |
| Burnt Orange | #cf4b04 |
| Bright Orange | #ffa300 |
| Green | #006B3E |

---

## 16. Security Hardening

### 16.1 Applied Fixes (cumulative)

| Issue | Fix |
|-------|-----|
| Bot protection | Cloudflare Turnstile on login + signup |
| MFA support | TOTP enrollment + verification + admin reset |
| Admin audit trail | `admin_action_log` for all impersonation |
| Storage isolation | Volunteers scoped to `auth.uid()` folder |
| Messaging RLS | Checks `is_archived = false`, names via messages |
| Bulk conversation privacy | Trigger enforces max 2 participants |
| Private notes | Strict `volunteer_id = auth.uid()` |
| Document expiry | Automated via pg_cron |
| Overbooking | Trigger validates with `FOR UPDATE` row lock + UPDATE coverage |
| BG cascade | Cancels future + waitlisted, skips same-day |
| Calendar auth | Long-lived UUID token |
| Cross-tab timeout | localStorage StorageEvent sync |
| PWA stale data | NetworkOnly for booking endpoints |
| Novelty bias | Log-scale with 0.3 floor |
| Points double-count | State delta check + DELETE handler |
| Hours letter same-day | Filter `shift_date <= today` |
| Admin signature | Deterministic ordering (oldest admin) |
| Leaderboard ties | `points → consistency → created_at` |
| Resend click tracking | `data-resend-track="false"` on all email links |
| WaitlistStatus / CoverageAlert | Fixed `status` → `booking_status` |
| /mfa-verify timeout | Added to EXCLUDED_PATHS |
| AuthContext double fetch | Removed `getSession()`, onAuthStateChange only |
| BrowseShifts ShiftCard | Extracted to module-level component |
| OnboardingModal wasted query | Departments fetch only when onboarding needed |
| Turnstile secret rotation | Rotated after exposure in terminal output |

### 16.2 Credential Storage

| Secret | Location |
|--------|----------|
| Supabase URL + anon key | Vercel env vars |
| Resend API key | Supabase Edge Function secret |
| Twilio SID/Auth/Phone | Supabase Edge Function secrets |
| Turnstile site key | Vercel (`VITE_TURNSTILE_SITE_KEY`) |
| Turnstile secret key | Supabase secret + Auth Bot Protection |
| GA4 Measurement ID | Vercel (`VITE_GA_MEASUREMENT_ID`) |
| Android keystore | Local file (gitignored) + GitHub secrets (base64) |

---

## 17. CI/CD & Deployment

### 17.1 Web Pipeline

```
Push to main → GitHub Actions CI → Vercel auto-deploy → SW auto-update
```

### 17.2 Edge Function Deployment

```bash
npx supabase functions deploy <name> --project-ref esycmohgumryeqteiwla
```

7 deployed functions: send-email, send-sms, notification-webhook, delete-user, admin-act-on-behalf, calendar-feed, admin-reset-mfa

### 17.3 Android Pipeline

```
Local: bubblewrap build → app-release-bundle.aab
  OR
git tag android-v1.0.0 → push → GitHub Actions → AAB artifact
```

### 17.4 Type Generation

```bash
npx supabase gen types typescript --project-id esycmohgumryeqteiwla > src/integrations/supabase/types.ts
```

---

## 18. Codebase Metrics

| Metric | Count |
|--------|-------|
| Source files (.ts/.tsx) | 128 |
| Page components | 27 |
| Custom components (non-UI) | 32 |
| shadcn/ui components | 53 |
| Custom hooks | 5 |
| Database tables | 28 |
| Database views | 1 |
| Database functions | 17 |
| Database triggers | 7 |
| pg_cron jobs | 4 |
| SQL migrations | 16 |
| Edge Functions | 7 (admin-act-on-behalf, admin-reset-mfa, calendar-feed, delete-user, notification-webhook, send-email, send-sms) |
| Storage buckets | 2 |
| Git commits | 80+ |
| Bugs fixed (audits) | 22+ |
| Sprints completed | 4 of 4 (Sprint 4 code-side; manual upload pending dev account verification) |

---

## 19. Known Limitations & Future Work

### 19.1 Current Limitations

| Item | Notes |
|------|-------|
| Google Play developer verification | Required before AAB upload (1-2 weeks for address verification) |
| Twilio trial | Only verified numbers receive SMS until upgrade |
| Resend sandbox | All emails redirect to admin inbox until domain verified |
| Landing page hosting | LocalWP only, needs production domain |
| Bundle size | ~940KB main chunk, code-splitting recommended |
| Act-on-behalf UI | Edge Function deployed; AdminUsers dialog pending |
| MFA recovery codes | Supabase generates them but frontend doesn't force save |
| Closed test requirement | New Play Console flow needs 12 testers × 14 days before production |

### 19.2 Sprint 4 Status

| Step | Status |
|------|--------|
| 4.0 — JDK 17 + Bubblewrap installed | ✅ |
| 4.1 — PWA manifest Bubblewrap-ready | ✅ |
| 4.2 — `bubblewrap init` (interactive) | ✅ |
| 4.3 — `bubblewrap build` (signed AAB + APK) | ✅ |
| 4.4 — assetlinks.json + vercel.json | ✅ (placeholder, needs SHA-256 after upload) |
| 4.5 — GitHub Actions workflow | ✅ |
| 4.6 — TWA detection in main.tsx | ✅ |
| 4.7 — Privacy policy + listing docs | ✅ |
| Manual: Play Console upload | ⏳ Blocked on developer verification |
| Manual: SHA-256 → assetlinks.json | ⏳ After first upload |
| Manual: Closed test (12 testers × 14 days) | ⏳ After upload |
| Manual: Production rollout | ⏳ After closed test |

### 19.3 Future Enhancements

- Code splitting (`React.lazy` + `Suspense`)
- Web Push notifications
- Reporting dashboard (admin analytics)
- Two-way Google Calendar sync
- Multi-language (i18n for Spanish)
- Audit log viewer in admin UI
- MFA recovery codes UX (force save during enrollment)

---

*Generated April 7, 2026 — Easterseals Iowa Volunteer Scheduler v6.0 (post Sprint 4 + audit fixes)*
