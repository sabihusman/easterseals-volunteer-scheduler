# Easterseals Iowa Volunteer Scheduler — Technical Specification v5

**Version:** 5.0
**Date:** April 6, 2026
**Repository:** github.com/sabihusman/easterseals-volunteer-scheduler
**Live URL:** easterseals-volunteer-scheduler.vercel.app
**Supabase Project:** esycmohgumryeqteiwla.supabase.co
**WordPress Landing:** easterseals-volunteer.local (LocalWP)

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
9. [Points System & Leaderboard](#9-points-system--leaderboard)
10. [Progressive Web App](#10-progressive-web-app)
11. [Volunteer Hours Letter](#11-volunteer-hours-letter)
12. [Calendar Subscription](#12-calendar-subscription)
13. [Analytics (GA4)](#13-analytics-ga4)
14. [WordPress Landing Page](#14-wordpress-landing-page)
15. [Security Hardening](#15-security-hardening)
16. [CI/CD & Deployment](#16-cicd--deployment)
17. [Codebase Metrics](#17-codebase-metrics)
18. [Known Limitations & Future Work](#18-known-limitations--future-work)

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
| **Landing Page** | WordPress 6.9.4 (LocalWP) | Custom theme |

### 1.2 Architecture Diagram

```
                        +---------------------------+
                        |    Vercel CDN / Hosting    |
                        |   (auto-deploy from Git)   |
                        +-------------+-------------+
                                      |
                        +-------------v--------------+
                        |   React SPA (PWA)           |
                        |   TypeScript + Tailwind     |
                        |   Service Worker (Workbox)  |
                        |   Turnstile + MFA + GA4     |
                        +---+--------+----------+----+
                            |        |          |
              +-------------+  +-----v-----+  +-v-----------+
              |                |             |               |
    +---------v--------+ +----v----+ +------v------+ +------v------+
    | Supabase Auth    | | Supabase| | Supabase    | | Supabase    |
    | (email, Google,  | | Realtime| | Storage     | | Edge Funcs  |
    |  MFA/TOTP)       | +---------+ +-------------+ +------+------+
    +------------------+       |          |                  |
              |                |          |         +--------+--------+
              +-------+--------+----------+         |                 |
                      |                       +-----v-----+  +-------v-------+
              +-------v-----------------------+            |  |               |
              |      PostgreSQL (Supabase)    |  Resend    |  |   Twilio      |
              | 28 tables, 1 view, 16 funcs  |  (email)   |  |   (SMS)       |
              | 6 triggers, pg_cron jobs     |  +----------+  +---------------+
              +------------------------------+
                              |
                    +---------v---------+
                    | Cloudflare        |
                    | Turnstile (CAPTCHA)|
                    +-------------------+
```

### 1.3 Project Structure

```
easterseals-volunteer-scheduler/
  src/
    App.tsx                            # Router, ProtectedRoute, providers
    main.tsx                           # Entry + ThemeProvider (next-themes)
    contexts/
      AuthContext.tsx                   # Session, user, profile, role
    pages/                             # 26 page components
      MfaVerify.tsx                    # MFA TOTP verification after login
    components/                        # 32 custom + 53 shadcn/ui
      messaging/                       #   6 messaging components
      Avatar.tsx                       #   Reusable avatar (image or initials)
      VolunteerLeaderboard.tsx         #   Top 10 Recharts bar chart
      VolunteerImpactCharts.tsx        #   Hours/month + confirmed vs no-shows
      VolunteerHoursLetter.tsx         #   PDF letter generator
      VolunteerReliabilityBadge.tsx    #   Reliability tier badge
      RecommendedShifts.tsx            #   Smart shift recommendations
      DocumentStatusBadge.tsx          #   Document status badge
      ui/                              #   53 shadcn/ui primitives
    hooks/                             # 5 custom hooks
      useUnreadCount.ts                #   Global message unread badge
      useInteractionTracking.ts        #   Fire-and-forget shift interactions
      useInactivityTimeout.ts          #   Cross-tab activity sync
    integrations/supabase/
      client.ts                        # Typed Supabase client
      types.ts                         # Auto-generated DB types (~2000 lines)
    lib/
      analytics.ts                     # GA4 trackEvent wrapper
      calendar-utils.ts                # ICS/CSV export, date helpers
      email-utils.ts                   # Edge function email wrapper
      slot-utils.ts                    # Time slot formatting
      utils.ts                         # cn() tailwind merge
  public/
    icon-192.png, icon-512.png         # PWA icons (maskable)
    apple-touch-icon.png               # iOS icon
    favicon.ico                        # Browser favicon
  supabase/
    migrations/                        # 14 SQL migration files
    functions/
      send-email/index.ts              # Resend email delivery (10 templates)
      send-sms/index.ts                # Twilio SMS delivery
      notification-webhook/index.ts    # Routes notifications to email/SMS with type-specific prefs
      delete-user/index.ts             # Account deletion handler
      admin-act-on-behalf/index.ts     # Admin impersonation (4 actions + audit log)
      calendar-feed/index.ts           # ICS calendar subscription feed
  index.html                           # SPA entry + GA4 gtag
  vite.config.ts                       # Vite + PWA plugin config
  vercel.json                          # SPA rewrites
```

---

## 2. Database Schema

### 2.1 Entity Relationship Overview

The database contains **28 tables**, **1 view**, **16 functions**, **6 triggers**, and **4 pg_cron scheduled jobs**.

#### Core Domain Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User accounts | full_name, email, phone, role, bg_check_status, total_hours, consistency_score, volunteer_points, avatar_url, onboarding_complete, emergency_contact_name/phone, notif_email/in_app/sms, notif_shift_reminders/new_messages/milestone/document_expiry/booking_changes |
| `departments` | Volunteer departments | name, description, location_id, requires_bg_check, allows_groups, min_age, is_active |
| `locations` | Physical locations | name, address, city, state, timezone |
| `shifts` | Shift definitions | title, shift_date, start_time, end_time, department_id, total_slots, booked_slots, status, requires_bg_check, is_recurring, coordinator_note |
| `shift_bookings` | Volunteer signups | shift_id, volunteer_id, booking_status, confirmation_status, final_hours, hours_source |
| `shift_time_slots` | 2-hour slot breakdown | shift_id, slot_start, slot_end, total_slots, booked_slots |
| `shift_booking_slots` | Booking-to-slot M:N | booking_id, slot_id |

#### Shift Lifecycle Tables

| Table | Purpose |
|-------|---------|
| `shift_recurrence_rules` | Recurring shift patterns (daily/weekly/biweekly/monthly) |
| `shift_notes` | Coordinator notes on bookings |
| `shift_attachments` | Files attached to shift notes |
| `shift_invitations` | Invite-a-friend tokens with expiry |
| `volunteer_shift_reports` | Self-confirmation: hours, star_rating (1-5), feedback |
| `confirmation_reminders` | Escalation tracking for coordinators/admins |

#### Recommendation Engine Tables

| Table | Purpose |
|-------|---------|
| `volunteer_shift_interactions` | Tracks viewed, signed_up, cancelled, completed, no_show |
| `volunteer_preferences` | Affinity scores: department, day_of_week, time_of_day, reliability |
| `shift_fill_rates` (view) | Calculated fill ratios per shift |

#### Messaging Tables

| Table | Purpose |
|-------|---------|
| `conversations` | Thread metadata: subject, type (direct/bulk), department_id |
| `conversation_participants` | Membership: last_read_at, is_archived |
| `messages` | Content with Supabase Realtime subscription |

#### Document Management Tables

| Table | Purpose |
|-------|---------|
| `document_types` | Admin-defined: name, is_required, has_expiry, expiry_days |
| `volunteer_documents` | Uploads: status (pending_review/approved/rejected/expired), expires_at |

#### Supporting Tables

| Table | Purpose |
|-------|---------|
| `notifications` | In-app + webhook trigger for email/SMS, includes `data` jsonb |
| `events` | Community events |
| `event_registrations` | Volunteer event RSVPs |
| `department_coordinators` | Coordinator-to-department assignment |
| `department_restrictions` | Blocked volunteer-department pairs |
| `volunteer_private_notes` | Volunteer-only private notes (no admin access) |
| `admin_action_log` | Audit log for admin act-on-behalf actions |

### 2.2 Enums

| Enum | Values |
|------|--------|
| `user_role` | volunteer, coordinator, admin |
| `booking_status` | confirmed, cancelled, waitlisted |
| `confirmation_status` | pending_confirmation, confirmed, no_show |
| `bg_check_status` | pending, cleared, failed, expired |
| `shift_status` | open, full, cancelled, completed |
| `shift_time_type` | morning, afternoon, all_day, custom |
| `recurrence_type` | daily, weekly, biweekly, monthly |
| `interaction_type` | viewed, signed_up, cancelled, completed, no_show |
| `self_confirm_status` | pending, attended, no_show |
| `reminder_recipient` | coordinator, admin |

### 2.3 Database Functions (16)

| Function | Purpose |
|----------|---------|
| `score_shifts_for_volunteer(uuid, int)` | Recommendation scoring: preference(0.5) + org_need(0.3) + novelty(0.2, log-scale, 0.3 floor) |
| `is_admin()` | RLS helper |
| `is_coordinator_or_admin()` | RLS helper |
| `my_role()` | Returns current user's role |
| `recalculate_consistency(uuid)` | Updates reliability score |
| `update_volunteer_preferences(uuid)` | Syncs affinity scores from interactions |
| `resolve_hours_discrepancy(uuid)` | Resolves volunteer vs coordinator hours |
| `transfer_admin_role(uuid, uuid)` | Transfers admin privileges |
| `export_critical_data()` | Full data export |
| `expire_documents()` | Marks expired docs + sends notifications |
| `warn_expiring_documents()` | 30-day expiry warnings (weekly dedup) |
| `validate_booking_slot_count()` | Prevents overbooking via row lock |
| `enforce_bulk_conversation_limit()` | Max 2 participants on bulk conversations |
| `cascade_bg_check_expiry()` | Cancels future BG-required bookings on expiry |
| `notify_email_on_notification()` | Calls notification-webhook Edge Function |
| `recalculate_points(uuid)` | Computes volunteer points from shifts + ratings + milestones |

### 2.4 Triggers (6)

| Trigger | Table | Event | Action |
|---------|-------|-------|--------|
| `trg_interaction_update_preferences` | volunteer_shift_interactions | INSERT | Updates affinity scores |
| `trg_email_on_notification` | notifications | INSERT (ALWAYS) | Calls notification-webhook |
| `trg_enforce_bulk_limit` | conversation_participants | INSERT | Blocks 3+ participants on bulk |
| `trg_validate_booking_slots` | shift_bookings | INSERT/UPDATE (confirmed) | Validates slot count with row lock |
| `trg_cascade_bg_check_expiry` | profiles | UPDATE (bg_check_status) | Cancels future BG-required bookings |
| `trg_recalculate_points` | shift_bookings | UPDATE (confirmation_status=confirmed) | Recalculates volunteer points |

### 2.5 Scheduled Jobs (pg_cron)

| Job | Schedule (UTC) | Iowa Time | Function |
|-----|---------------|-----------|----------|
| `expire-documents-daily` | 7:00 AM | ~2 AM CDT | `expire_documents()` |
| `warn-expiring-documents-daily` | 1:00 PM | ~8 AM CDT | `warn_expiring_documents()` |
| `shift-reminder-24h` | Every hour at :00 | — | 24h shift reminders (deduped) |
| `shift-reminder-2h` | Every hour at :30 | — | 2h shift reminders (deduped) |

### 2.6 Storage Buckets

| Bucket | Access | Path Convention |
|--------|--------|-----------------|
| `shift-attachments` | Coordinator/admin upload, authenticated read | `{userId}/{filename}` |
| `volunteer-documents` | Volunteer: own folder only. Staff: read all | `{userId}/{docTypeId}/{timestamp}.{ext}` |

---

## 3. Authentication & Authorization

### 3.1 Auth Flow

- **Provider:** Supabase Auth (email/password + Google OAuth)
- **Bot Protection:** Cloudflare Turnstile on login + signup (captchaToken passed to Supabase)
- **MFA:** TOTP (authenticator app) — optional enrollment per user via Settings
- **Session:** JWT in localStorage, auto-refresh enabled
- **Onboarding:** 5-step modal for volunteers only (closeable)
- **Inactivity timeout:** DOM-event-based timer with cross-tab localStorage sync

### 3.2 MFA Flow

```
Login (email/password + Turnstile token)
  → Supabase returns session
  → Check session.user.factors for verified TOTP factor
  → If MFA enrolled: redirect to /mfa-verify
    → User enters 6-digit code
    → challengeAndVerify() → redirect to /dashboard
  → If no MFA: direct to /dashboard
```

Enrollment/unenrollment managed in Settings > Security section.

### 3.3 Role-Based Route Protection

| Route Pattern | Required Role |
|---------------|--------------|
| `/dashboard`, `/shifts`, `/history`, `/notes`, `/documents` | volunteer |
| `/coordinator`, `/coordinator/manage` | coordinator or admin |
| `/admin/*` | admin |
| `/messages`, `/settings`, `/events` | any authenticated |
| `/auth`, `/forgot-password`, `/reset-password`, `/mfa-verify` | unauthenticated/public |

### 3.4 Row Level Security Patterns

| Pattern | Implementation |
|---------|---------------|
| Own-data isolation | `volunteer_id = auth.uid()` |
| Role escalation | `public.is_admin()` or `public.is_coordinator_or_admin()` |
| Conversation access | `EXISTS` on participants with `is_archived = false` |
| Private notes | Strict `volunteer_id = auth.uid()` — no admin override |
| Storage scoping | `(storage.foldername(name))[1] = auth.uid()::text` |
| Admin audit | `admin_action_log` records all act-on-behalf actions |

---

## 4. Feature Inventory

### 4.1 Volunteer Features

| Feature | Component(s) | Description |
|---------|-------------|-------------|
| Dashboard | VolunteerDashboard.tsx | Shifts, hours, points, milestones, pending confirmations |
| Browse Shifts | BrowseShifts.tsx + RecommendedShifts.tsx | Search/filter + top 8 personalized recommendations |
| Shift History | ShiftHistory.tsx | Past shifts, hours breakdown, CSV export |
| Hours Letter | VolunteerHoursLetter.tsx | PDF letter with Easterseals letterhead + admin signature |
| Shift Confirmation | ShiftConfirmation.tsx | Self-report hours, rate (1-5 stars), feedback |
| Impact Charts | VolunteerImpactCharts.tsx | Hours/month + confirmed vs no-shows (Recharts) |
| Private Notes | MyNotes.tsx | Shift-linked notes, auto-lock 7 days, PDF export |
| Documents | VolunteerDocuments.tsx | Upload required documents, view status |
| Messaging | Messages.tsx + 5 sub-components | Real-time 1:1 threads with coordinators |
| Events | VolunteerEvents.tsx | View and register for community events |
| Onboarding | OnboardingModal.tsx | 5-step first-login flow (volunteers only) |
| Settings | Settings.tsx | Profile, emergency contacts, password, MFA, notifications, theme |
| Calendar Sync | Settings.tsx (section) | webcal:// subscription for Google/Apple/Outlook |

### 4.2 Coordinator Features

| Feature | Component(s) | Description |
|---------|-------------|-------------|
| Department Dashboard | CoordinatorDashboard.tsx | Shift overview for assigned departments |
| Manage Shifts | ManageShifts.tsx | CRUD shifts, recurring patterns |
| Hours Confirmation | CoordinatorHoursConfirmation.tsx | Record/override volunteer hours |
| Messaging | Messages.tsx | Direct + bulk messaging to department volunteers |
| Volunteer Activity | VolunteerActivityTab.tsx | Bookings, hours, ratings per volunteer |

### 4.3 Admin Features

| Feature | Component(s) | Description |
|---------|-------------|-------------|
| Admin Dashboard | AdminDashboard.tsx | All shifts, stats, leaderboard |
| Leaderboard | VolunteerLeaderboard.tsx | Top 10 by points (Recharts, gold/silver/bronze) |
| User Management | AdminUsers.tsx | Roles, BG checks, activation, act-on-behalf |
| Act-on-Behalf | admin-act-on-behalf Edge Function | Book/cancel/confirm/update for volunteers (audited) |
| Departments | AdminDepartments.tsx | CRUD departments, assign coordinators |
| Events | AdminEvents.tsx | CRUD community events |
| Reminders | AdminReminders.tsx | Shift confirmation reminder configuration |
| Document Types | AdminDocumentTypes.tsx | Define required doc types with expiry |
| Compliance | DocumentCompliance.tsx | Volunteer compliance matrix, approve/reject |
| Admin Settings | AdminSettings.tsx | System configuration |
| Bulk Messaging | BulkComposeMessage.tsx | Filter by department/BG status |

### 4.4 Cross-Cutting Features

| Feature | Implementation |
|---------|---------------|
| Real-time notifications | NotificationBell.tsx + Postgres Changes |
| Real-time messaging | Supabase Realtime on `messages` table |
| Interaction tracking | useInteractionTracking.ts (fire-and-forget) |
| Reliability scoring | VolunteerReliabilityBadge.tsx (New/Reliable/Watch/Concern) |
| BG check enforcement | Recommendations, booking, events + cascade on expiry |
| Anti-overbooking | Database trigger with `FOR UPDATE` row lock |
| Booking window | 14 days standard, 21 days BG-required |
| Cross-tab timeout | localStorage sync via StorageEvent |
| Dark/light theme | next-themes with toggle in header + Settings |
| Bot protection | Cloudflare Turnstile on auth forms |
| Analytics | GA4 event tracking (login, booking, confirmation, etc.) |

---

## 5. Messaging System

### 5.1 Architecture

- **Model:** One conversation per user pair (direct) or per bulk recipient
- **Real-time:** Supabase Realtime subscription on `messages` filtered by `conversation_id`
- **Notifications:** Inserts trigger email + SMS via webhook (respects `notif_new_messages` preference)
- **Unread tracking:** `last_read_at` vs latest message timestamp
- **Bulk:** Creates individual 1:1 conversations; enforced max 2 participants by trigger

### 5.2 Security

- Archived participants blocked from read/write (RLS checks `is_archived = false`)
- Hard delete via creator or admin
- Admin can read all conversations for oversight

---

## 6. Document Management

### 6.1 Status Flow

```
[missing] → Upload → [pending_review] → Approve → [approved]
                                       → Reject  → [rejected]
[approved] → expires_at passes → [expired] (pg_cron daily at 2 AM Iowa)
[rejected/expired] → Re-upload → [pending_review]
```

### 6.2 Automation

- `expire_documents()` runs daily: transitions approved → expired + notification
- `warn_expiring_documents()` runs daily: 30-day warning (weekly dedup)
- BG check expiry cascades to cancel future bookings on restricted shifts

---

## 7. Recommendation Engine

### 7.1 Scoring Formula

```
final_score = preference_match × 0.5 + org_need × 0.3 + novelty × 0.2
```

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Preference Match | 50% | Department affinity (0-100 normalized to 0-1) |
| Organizational Need | 30% | `1.0 - (booked / total)` |
| Novelty | 20% | `max(1.0 - ln(1+interactions) / ln(1+cap), 0.3)` — log scale, 0.3 floor, cap at 50 |

### 7.2 Key Behaviors

- Booking window respected via `p_max_days` parameter (14 or 21 days)
- BG check status enforced
- Trigger updates affinity on every interaction
- Active volunteers not penalized (novelty floor 0.3)

---

## 8. Notification System

### 8.1 Delivery Chain

```
App inserts into notifications table
  → trg_email_on_notification (ALWAYS trigger)
    → notification-webhook Edge Function
      → Check profile.notif_email → send-email (Resend)
      → Check profile.notif_sms + phone → send-sms (Twilio)
      → Type-specific prefs gate email/SMS (in-app always delivered)
```

### 8.2 Notification Types

| Type | SMS | Email | Category Pref |
|------|-----|-------|---------------|
| `shift_reminder` | ✅ | ✅ | notif_shift_reminders |
| `shift_reminder_auto` | ✅ | ✅ | notif_shift_reminders |
| `self_confirmation_reminder` | ✅ | ✅ | notif_shift_reminders |
| `new_message` | ✅ | ✅ | notif_new_messages |
| `hours_milestone` | ✅ | ✅ | notif_milestone |
| `document_expired` | ✅ | ✅ | notif_document_expiry |
| `document_expiry_warning` | ✅ | ✅ | notif_document_expiry |
| `booking_confirmed` | ✅ | ✅ | notif_booking_changes |
| `booking_cancelled` | ✅ | ✅ | notif_booking_changes |
| `late_cancellation` | ✅ | ✅ | notif_booking_changes |
| `waitlist_notification` | ✅ | ✅ | notif_booking_changes |
| `bg_check_status_change` | ✅ | ✅ | — (always sent) |

### 8.3 User Preferences (two-level)

**Level 1 — Channel toggles:** Email, In-app, SMS
**Level 2 — Category toggles:** Shift reminders, New messages, Milestones, Document expiry, Booking changes

Category toggles only gate email/SMS. In-app notifications always delivered.

---

## 9. Points System & Leaderboard

### 9.1 Points Calculation

| Action | Points |
|--------|--------|
| Each confirmed completed shift | +10 |
| Each 5-star shift rating | +5 |
| Each 10-hour milestone | +25 |

Recalculated automatically via trigger when `confirmation_status` changes to `confirmed`.

### 9.2 Leaderboard

- Top 10 volunteers by `volunteer_points`
- Recharts horizontal BarChart
- Gold (#FFD700), silver (#C0C0C0), bronze (#CD7F32) for top 3
- "Your rank" footer for current user if not in top 10
- Visible to admins/coordinators on Admin Dashboard

### 9.3 Volunteer View

- Points displayed on Volunteer Dashboard as stat card
- Impact charts (collapsible): hours by month + confirmed vs no-shows

---

## 10. Progressive Web App

### 10.1 Configuration

| Setting | Value |
|---------|-------|
| Plugin | vite-plugin-pwa 1.2.0 |
| Register Type | autoUpdate |
| Display | standalone |
| Orientation | portrait-primary |
| Theme Color | #006B3E |

### 10.2 Caching Strategy

| Resource | Strategy | TTL |
|----------|----------|-----|
| Static assets | Precache | Build-versioned |
| Booking API (shifts, shift_bookings) | **NetworkOnly** | No cache (prevents phantom slots) |
| Other Supabase API | NetworkFirst | 60 seconds, max 50 entries |
| Google Fonts | CacheFirst | 1 year |

---

## 11. Volunteer Hours Letter

- Professional PDF with Easterseals Iowa letterhead (#006B3E)
- Only includes shifts with `confirmation_status = 'confirmed'` + `final_hours IS NOT NULL` + `shift_date <= today`
- Detailed shift table: Date, Title, Department, Hours
- Admin signature (oldest admin by `created_at` — deterministic)
- Browser print-to-PDF (no external library)
- Button disabled when `total_hours = 0`

---

## 12. Calendar Subscription

- Edge Function: `calendar-feed/index.ts`
- Returns valid ICS file with one `VEVENT` per upcoming confirmed shift
- Timezone: `America/Chicago`
- Stable UIDs: `{shift_id}@easterseals-volunteer-scheduler`
- Auth via JWT query parameter (calendar apps can't set headers)
- `Cache-Control: no-store` for live updates
- Deep-links for Google Calendar, Apple Calendar, Outlook

---

## 13. Analytics (GA4)

- Measurement ID: configured via `VITE_GA_MEASUREMENT_ID` env var
- gtag.js loaded conditionally (only when ID is set)
- `trackEvent(name, params)` utility in `src/lib/analytics.ts`
- No PII in events
- Key events: login, shift_booked, shift_cancelled, hours_self_confirmed, hours_letter_generated, document_uploaded, mfa_enrolled

---

## 14. WordPress Landing Page

### 14.1 Sections

1. Top bar (burnt orange #cf4b04)
2. Sticky header with Easterseals logo + "Volunteer Portal" CTA
3. Split hero: orange panel + navy brand text
4. Stats bar (4 gold counters on navy)
5. How It Works (4 step cards)
6. Departments (6 cards with SVG icons)
7. Features (2x2 grid with green dot accents)
8. CTA section (navy, sign-up buttons)
9. 4-column footer

### 14.2 Colors

| Name | Hex | Usage |
|------|-----|-------|
| Navy | #1B2A4A | Hero right, stats, CTA, footer |
| Burnt Orange | #cf4b04 | Top bar, hero, nav button |
| Bright Orange | #ffa300 | Accents, stat numbers, brand text |
| Green | #006B3E | Easterseals brand |

---

## 15. Security Hardening

### 15.1 Applied Fixes

| Issue | Fix |
|-------|-----|
| Bot protection | Cloudflare Turnstile on login + signup |
| MFA support | TOTP enrollment + verification |
| Admin audit trail | `admin_action_log` for all act-on-behalf actions |
| Storage isolation | Volunteers scoped to `auth.uid()` folder |
| Messaging leaks | RLS checks `is_archived = false` |
| Bulk conversation privacy | Trigger enforces max 2 participants |
| Private notes | Strict `volunteer_id = auth.uid()`, no admin override |
| Document expiry | Automated via pg_cron + notification |
| Overbooking | Trigger validates count with `FOR UPDATE` row lock |
| BG check cascade | Cancels future bookings when BG expires/fails |
| Cross-tab timeout | localStorage sync via StorageEvent |
| PWA stale data | NetworkOnly for booking endpoints |
| Novelty bias | Log-scale with 0.3 floor |

### 15.2 Credential Storage

| Secret | Location |
|--------|----------|
| Supabase URL + anon key | Vercel env vars |
| Resend API key | Supabase Edge Function secret |
| Twilio SID + Auth Token + Phone | Supabase Edge Function secrets |
| Turnstile site key | Vercel env var (VITE_TURNSTILE_SITE_KEY) |
| Turnstile secret key | Supabase secret + Supabase Auth Bot Protection |
| GA4 Measurement ID | Vercel env var (VITE_GA_MEASUREMENT_ID) |

---

## 16. CI/CD & Deployment

### 16.1 Pipeline

```
Push to main → GitHub Actions CI → Vercel auto-deploy → SW auto-update
```

### 16.2 Edge Function Deployment

```bash
npx supabase functions deploy <name> --project-ref esycmohgumryeqteiwla
```

6 deployed functions: send-email, send-sms, notification-webhook, delete-user, admin-act-on-behalf, calendar-feed

### 16.3 Type Generation

```bash
npx supabase gen types typescript --project-id esycmohgumryeqteiwla > src/integrations/supabase/types.ts
```

---

## 17. Codebase Metrics

| Metric | Count |
|--------|-------|
| Source files (.ts/.tsx) | 127 |
| Page components | 26 |
| Custom components (non-UI) | 32 |
| shadcn/ui components | 53 |
| Custom hooks | 5 |
| Database tables | 28 |
| Database views | 1 |
| Database functions | 16 |
| Database triggers | 6 |
| pg_cron jobs | 4 |
| SQL migrations | 14 |
| Edge Functions | 6 |
| Storage buckets | 2 |
| Git commits | 70+ |

---

## 18. Known Limitations & Future Work

### 18.1 Current Limitations

| Item | Notes |
|------|-------|
| Twilio trial | Only verified numbers receive SMS until account upgraded |
| Landing page | LocalWP only; needs domain + production hosting |
| Bundle size | ~940KB main chunk; code-splitting recommended |
| Email sandbox | Resend redirects to admin inbox until domain verified |
| Avatar upload | Component exists; full upload flow in Settings to be wired |
| Act-on-behalf UI | Edge Function deployed; AdminUsers dialog to be completed |

### 18.2 Sprint 4 (Planned)

- Android TWA app via Bubblewrap CLI
- Google Play Store listing
- Digital Asset Links verification
- GitHub Actions workflow for Android builds
- Privacy policy page

### 18.3 Future Enhancements

- Code splitting (React.lazy + Suspense)
- Web Push notifications
- Reporting dashboard (admin analytics)
- Two-way Google Calendar sync
- Multi-language (i18n for Spanish)
- Audit log viewer in admin UI

---

*Generated April 6, 2026 — Easterseals Iowa Volunteer Scheduler v5.0*
