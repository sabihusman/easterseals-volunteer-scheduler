# Easterseals Iowa Volunteer Scheduler — Technical Specification v4

**Version:** 4.0
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
8. [SMS Notifications (Twilio)](#8-sms-notifications-twilio)
9. [Progressive Web App](#9-progressive-web-app)
10. [Volunteer Hours Letter](#10-volunteer-hours-letter)
11. [WordPress Landing Page](#11-wordpress-landing-page)
12. [Security Hardening](#12-security-hardening)
13. [CI/CD & Deployment](#13-cicd--deployment)
14. [Codebase Metrics](#14-codebase-metrics)
15. [Known Limitations & Future Work](#15-known-limitations--future-work)

---

## 1. System Architecture

### 1.1 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 18.3.1 |
| **Language** | TypeScript | 5.8.3 |
| **Build Tool** | Vite | 5.4.19 |
| **CSS** | Tailwind CSS | 3.4.17 |
| **UI Components** | shadcn/ui (Radix UI) | Latest |
| **Routing** | React Router | 6.30.1 |
| **Server State** | TanStack React Query | 5.83.0 |
| **Forms** | React Hook Form + Zod | 7.61.1 / 3.25.76 |
| **Charts** | Recharts | 2.15.4 |
| **Dates** | date-fns | 3.6.0 |
| **Toasts** | Sonner | 1.7.4 |
| **Backend** | Supabase (PostgreSQL 15) | 2.100.1 |
| **Auth** | Supabase Auth | Built-in |
| **Storage** | Supabase Storage | Built-in |
| **Real-time** | Supabase Realtime | Built-in |
| **Email** | Resend (via Edge Function) | Edge Function |
| **SMS** | Twilio (via Edge Function) | Edge Function |
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
                        +-------------v-------------+
                        |   React SPA (PWA)          |
                        |   TypeScript + Tailwind    |
                        |   Service Worker (Workbox) |
                        +---+--------+----------+---+
                            |        |          |
              +-------------+  +-----v-----+  +-v-----------+
              |                |             |               |
    +---------v--------+ +----v----+ +------v------+ +------v------+
    | Supabase Auth    | | Supabase| | Supabase    | | Supabase    |
    | (email, Google)  | | Realtime| | Storage     | | Edge Funcs  |
    +------------------+ +---------+ +-------------+ +------+------+
              |                |          |                  |
              +-------+--------+----------+--------+---------+
                      |                            |
              +-------v----------------------------v-------+
              |         PostgreSQL (Supabase)               |
              |   27 tables, 1 view, 9 functions, RLS      |
              |   pg_cron for scheduled jobs                |
              +--------------------------------------------+
                                      |
                        +-------------v-----------+
                        |   External Services      |
                        |   - Resend (email)       |
                        |   - Twilio (SMS)         |
                        +--------------------------+
```

**No custom API layer.** The frontend queries Supabase directly via the typed client. Row Level Security (RLS) policies enforce all authorization at the database level.

### 1.3 Project Structure

```
easterseals-volunteer-scheduler/
  src/
    App.tsx                            # Router, ProtectedRoute, providers
    main.tsx                           # Entry point
    contexts/
      AuthContext.tsx                   # Session, user, profile, role
    pages/                             # 25 page components
    components/                        # 29 custom components
      messaging/                       #   6 messaging components
      ui/                              #   53 shadcn/ui primitives
    hooks/                             # 5 custom hooks
    integrations/supabase/
      client.ts                        # Typed Supabase client
      types.ts                         # Auto-generated DB types (~1800 lines)
    lib/
      calendar-utils.ts                # ICS/CSV export, date helpers
      email-utils.ts                   # Edge function email wrapper
      slot-utils.ts                    # Time slot formatting
      utils.ts                         # cn() tailwind merge
  public/
    icon-192.png, icon-512.png         # PWA icons
    apple-touch-icon.png               # iOS icon
    favicon.ico                        # Browser favicon
  supabase/
    migrations/                        # 12 SQL migration files
    functions/
      send-email/index.ts              # Resend email delivery
      send-sms/index.ts                # Twilio SMS delivery
      notification-webhook/index.ts    # Routes notifications to email + SMS
      delete-user/index.ts             # Account deletion handler
  index.html                           # SPA entry with PWA meta tags
  vite.config.ts                       # Vite + PWA plugin config
```

---

## 2. Database Schema

### 2.1 Entity Relationship Overview

The database contains **27 tables**, **1 view**, and **9 functions**.

#### Core Domain Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User accounts | full_name, email, phone, role, bg_check_status, total_hours, consistency_score, onboarding_complete, emergency_contact_name, emergency_contact_phone, notif_email, notif_in_app, notif_sms |
| `departments` | Volunteer departments | name, description, location_id, requires_bg_check, allows_groups, min_age, is_active |
| `locations` | Physical locations | name, address, city, state, timezone |
| `shifts` | Shift definitions | title, shift_date, start_time, end_time, department_id, total_slots, booked_slots, status, requires_bg_check, is_recurring, coordinator_note |
| `shift_bookings` | Volunteer shift signups | shift_id, volunteer_id, booking_status, confirmation_status, final_hours, hours_source, volunteer_reported_hours, coordinator_reported_hours |
| `shift_time_slots` | 2-hour slot breakdown | shift_id, slot_start, slot_end, total_slots, booked_slots |
| `shift_booking_slots` | Booking-to-slot M:N | booking_id, slot_id |

#### Shift Lifecycle Tables

| Table | Purpose |
|-------|---------|
| `shift_recurrence_rules` | Recurring shift patterns (daily, weekly, biweekly, monthly) |
| `shift_notes` | Coordinator notes on bookings |
| `shift_attachments` | Files attached to shift notes |
| `shift_invitations` | Invite-a-friend tokens with expiry |
| `volunteer_shift_reports` | Self-confirmation: hours, rating (1-5 stars), feedback |
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
| `conversation_participants` | User membership: last_read_at, is_archived |
| `messages` | Content with real-time subscription via Supabase Realtime |

#### Document Management Tables

| Table | Purpose |
|-------|---------|
| `document_types` | Admin-defined types: name, is_required, has_expiry, expiry_days |
| `volunteer_documents` | Uploads: status (pending_review/approved/rejected/expired), expires_at |

#### Supporting Tables

| Table | Purpose |
|-------|---------|
| `notifications` | In-app + webhook trigger for email/SMS delivery |
| `events` | Community events with registration |
| `event_registrations` | Volunteer event RSVPs |
| `department_coordinators` | Coordinator-to-department assignment |
| `department_restrictions` | Blocked volunteer-department pairs |
| `volunteer_private_notes` | Volunteer's personal notes (strict privacy, no admin access) |

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

### 2.3 Database Functions

| Function | Purpose |
|----------|---------|
| `score_shifts_for_volunteer(uuid, int)` | Recommendation scoring with log-scale novelty (0.3 floor) |
| `is_admin()` | RLS helper: checks current user is admin |
| `is_coordinator_or_admin()` | RLS helper: coordinator or admin check |
| `my_role()` | Returns current user's role |
| `recalculate_consistency(uuid)` | Updates volunteer reliability score |
| `update_volunteer_preferences(uuid)` | Syncs affinity scores from interactions |
| `resolve_hours_discrepancy(uuid)` | Resolves volunteer vs coordinator reported hours |
| `transfer_admin_role(uuid, uuid)` | Transfers admin privileges between users |
| `export_critical_data()` | Full data export for backup |
| `expire_documents()` | Marks expired documents, sends notifications |
| `warn_expiring_documents()` | 30-day expiry warnings (deduped weekly) |
| `validate_booking_slot_count()` | Prevents overbooking via row lock |
| `enforce_bulk_conversation_limit()` | Max 2 participants on bulk conversations |
| `notify_email_on_notification()` | Calls notification-webhook Edge Function |

### 2.4 Triggers

| Trigger | Table | Event | Action |
|---------|-------|-------|--------|
| `trg_interaction_update_preferences` | volunteer_shift_interactions | INSERT | Updates affinity scores |
| `trg_email_on_notification` | notifications | INSERT | Calls notification-webhook (email + SMS) |
| `trg_enforce_bulk_limit` | conversation_participants | INSERT | Blocks 3+ participants on bulk conversations |
| `trg_validate_booking_slots` | shift_bookings | INSERT (confirmed) | Validates slot count with row lock |

### 2.5 Scheduled Jobs (pg_cron)

| Job | Schedule | Function |
|-----|----------|----------|
| `expire-documents-daily` | 2:00 AM daily | `expire_documents()` |
| `warn-expiring-documents-daily` | 8:00 AM daily | `warn_expiring_documents()` |

### 2.6 Storage Buckets

| Bucket | Access | Path Convention |
|--------|--------|-----------------|
| `shift-attachments` | Coordinator/admin upload, authenticated read | `{userId}/{filename}` |
| `volunteer-documents` | Volunteer: own folder only. Staff: read all | `{userId}/{docTypeId}/{timestamp}.{ext}` |

---

## 3. Authentication & Authorization

### 3.1 Auth Flow

- **Provider:** Supabase Auth (email/password + Google OAuth)
- **Session:** JWT in localStorage, auto-refresh enabled
- **Profile hydration:** On auth state change, fetches `profiles` row by `user.id`
- **Onboarding:** First-login modal for volunteers only (5-step flow)
- **Inactivity timeout:** DOM-event-based timer (mousemove, keydown, touch, scroll, click); background network requests do NOT reset the timer

### 3.2 Role-Based Route Protection

| Route Pattern | Required Role |
|---------------|--------------|
| `/dashboard`, `/shifts`, `/history`, `/notes`, `/documents` | volunteer |
| `/coordinator`, `/coordinator/manage` | coordinator or admin |
| `/admin/*` (dashboard, users, departments, events, reminders, settings, documents, compliance) | admin |
| `/messages`, `/settings`, `/events` | any authenticated |
| `/auth`, `/forgot-password`, `/reset-password` | unauthenticated |

### 3.3 Row Level Security Patterns

All 27 tables have RLS enabled. Key policy patterns:

| Pattern | Implementation |
|---------|---------------|
| Own-data isolation | `volunteer_id = auth.uid()` or `user_id = auth.uid()` |
| Role escalation | `public.is_admin()` or `public.is_coordinator_or_admin()` |
| Conversation membership | `EXISTS` on `conversation_participants` with `is_archived = false` |
| Private notes | Strict `volunteer_id = auth.uid()` — no admin override |
| Storage scoping | `(storage.foldername(name))[1] = auth.uid()::text` |

---

## 4. Feature Inventory

### 4.1 Volunteer Features

| Feature | Component(s) | Description |
|---------|-------------|-------------|
| Dashboard | VolunteerDashboard.tsx | Upcoming shifts, total hours, pending confirmations, milestones |
| Browse Shifts | BrowseShifts.tsx, RecommendedShifts.tsx | Search/filter + top 8 personalized recommendations |
| Shift History | ShiftHistory.tsx | Past shifts, hours breakdown, CSV export, milestone badges |
| Hours Letter | VolunteerHoursLetter.tsx | PDF confirmation letter with Easterseals letterhead + admin signature |
| Shift Confirmation | ShiftConfirmation.tsx | Self-report hours, rate shift (1-5), provide feedback |
| Private Notes | MyNotes.tsx | Personal notes linked to shifts/departments, auto-lock after 7 days, PDF export |
| Documents | VolunteerDocuments.tsx | Upload required documents, view status, re-upload on rejection |
| Messaging | Messages.tsx + 5 sub-components | 1:1 conversations with coordinators, real-time updates |
| Events | VolunteerEvents.tsx | View and register for community events |
| Onboarding | OnboardingModal.tsx | 5-step first-login flow (closeable, volunteers only) |
| Settings | Settings.tsx | Profile, emergency contacts, password, notification preferences (email/in-app/SMS) |

### 4.2 Coordinator Features

| Feature | Component(s) | Description |
|---------|-------------|-------------|
| Department Dashboard | CoordinatorDashboard.tsx | Shift overview for assigned departments |
| Manage Shifts | ManageShifts.tsx | Create, edit, cancel shifts; recurring shift rules |
| Hours Confirmation | CoordinatorHoursConfirmation.tsx | Record/override volunteer hours, resolve discrepancies |
| Messaging | Messages.tsx | Direct + bulk messaging to department volunteers |
| Volunteer Activity | VolunteerActivityTab.tsx | View volunteer bookings, hours, ratings |

### 4.3 Admin Features

| Feature | Component(s) | Description |
|---------|-------------|-------------|
| Admin Dashboard | AdminDashboard.tsx | All shifts overview, total bookings, volunteer count |
| User Management | AdminUsers.tsx | View/edit users, reliability badges, role management |
| Departments | AdminDepartments.tsx | CRUD departments, assign coordinators |
| Events | AdminEvents.tsx | CRUD community events |
| Reminders | AdminReminders.tsx | Configure shift confirmation reminder escalation |
| Document Types | AdminDocumentTypes.tsx | Define required doc types with expiry duration |
| Compliance | DocumentCompliance.tsx | Volunteer compliance matrix, approve/reject documents |
| Admin Settings | AdminSettings.tsx | System-wide configuration |
| Bulk Messaging | BulkComposeMessage.tsx | Message all volunteers, filter by department/BG status |

### 4.4 Cross-Cutting Features

| Feature | Implementation |
|---------|---------------|
| Real-time notifications | NotificationBell.tsx + Postgres Changes on `notifications` table |
| Real-time messaging | Supabase Realtime on `messages` table, filtered by conversation |
| Interaction tracking | useInteractionTracking.ts hook (fire-and-forget inserts) |
| Reliability scoring | VolunteerReliabilityBadge.tsx: New / Reliable / Watch / Concern tiers |
| BG check enforcement | Enforced in recommendations, shift booking, and event registration |
| Booking window | 14-day standard, 21-day for BG-check-required shifts |
| Anti-overbooking | Database trigger validates actual count with `FOR UPDATE` row lock |
| Session timeout | DOM-event-based inactivity timer with warning countdown |

---

## 5. Messaging System

### 5.1 Architecture

- **Model:** One conversation per pair of users (direct) or per bulk recipient
- **Real-time:** Supabase Realtime subscription on `messages` table filtered by `conversation_id`
- **Notifications:** New messages insert into `notifications` table, triggering email + SMS via webhook
- **Unread tracking:** `last_read_at` on `conversation_participants` compared against latest message timestamp
- **Bulk messaging:** Creates individual 1:1 conversation per recipient (privacy-safe); enforced by trigger

### 5.2 Security Controls

- Archived participants cannot read or send messages (RLS checks `is_archived = false`)
- Bulk conversations enforce max 2 participants via database trigger
- Conversation creator or admin can remove participants (hard delete)
- Admin can read all conversations for oversight

### 5.3 Component Tree

```
Messages.tsx (split-panel layout)
  ConversationList.tsx (left panel)
    - Search input
    - Conversation items with unread indicator + timestamp
  ConversationThread.tsx (right panel)
    - Auto-fetches participant names
    - Real-time message subscription
    - MessageBubble.tsx (sender-aligned with timestamp)
    - Compose input + send button
  ComposeMessage.tsx (dialog)
    - User search with role labels
    - Conversation deduplication
  BulkComposeMessage.tsx (dialog)
    - Department + BG status filters
    - Recipient count preview
```

---

## 6. Document Management

### 6.1 Workflow

```
Admin creates document types (e.g., "Background Check Certificate")
  |
  v
Volunteer sees required docs on /documents page
  |-- Uploads file (PDF, JPG, PNG, DOC — max 10MB)
  |-- File stored: volunteer-documents/{userId}/{docTypeId}/{timestamp}.{ext}
  |-- Status: pending_review
  |
  v
Admin/Coordinator reviews on /admin/compliance
  |-- Approve -> status: approved (expiry calculated if applicable)
  |-- Reject -> status: rejected (volunteer notified, can re-upload)
  |
  v
pg_cron daily checks:
  |-- 2 AM: approved + expired -> status: expired + notification
  |-- 8 AM: expiring within 30 days -> warning notification (weekly dedup)
```

### 6.2 Status Flow

```
[missing] --> Upload --> [pending_review] --> Approve --> [approved]
                                          --> Reject  --> [rejected]
[approved] --> expires_at passes --> [expired]
[rejected] or [expired] --> Re-upload --> [pending_review]
```

---

## 7. Recommendation Engine

### 7.1 Scoring Formula

```
final_score = preference_match * 0.5 + org_need * 0.3 + novelty * 0.2
```

| Factor | Weight | Calculation |
|--------|--------|-------------|
| **Preference Match** | 50% | Department affinity from `volunteer_preferences` (0-100 scale, normalized to 0-1) |
| **Organizational Need** | 30% | `1.0 - (booked_slots / total_slots)` — empty shifts score higher |
| **Novelty** | 20% | `max(1.0 - ln(1+interactions) / ln(1+max_interactions), 0.3)` — logarithmic decay with 0.3 floor |

### 7.2 Key Design Decisions

- **Novelty floor (0.3):** Prevents long-term active volunteers from being penalized vs new users
- **Interaction cap (50):** Normalization denominator capped to avoid extreme skew
- **Booking window:** Only shifts within 21 days of today are scored
- **BG check enforcement:** Shifts requiring background checks only shown to cleared volunteers
- **Trigger-based learning:** Every interaction (view, signup, cancel, complete, no-show) updates affinity scores in real-time

---

## 8. SMS Notifications (Twilio)

### 8.1 Architecture

```
Notification INSERT (from app)
  --> trg_email_on_notification (ALWAYS trigger)
    --> notification-webhook Edge Function
      --> Checks profile.notif_email -> calls send-email (Resend)
      --> Checks profile.notif_sms + profile.phone -> calls send-sms (Twilio)
```

### 8.2 SMS-Enabled Notification Types

| Type | Example SMS |
|------|------------|
| `shift_reminder` | [Easterseals Iowa] Shift Reminder: Your shift "Camp Setup" is tomorrow at 9:00 AM |
| `late_cancellation` | [Easterseals Iowa] Late Cancellation Alert: A volunteer cancelled... |
| `self_confirmation_reminder` | [Easterseals Iowa] Please confirm your attendance... |
| `new_message` | [Easterseals Iowa] New message from Sabih Usman: Hello... |
| `hours_milestone` | [Easterseals Iowa] Congratulations! You've reached 50 hours! |
| `waitlist_notification` | [Easterseals Iowa] A spot opened up for "Brain Power" |
| `document_expired` | [Easterseals Iowa] Document Expired: Background Check Certificate |
| `document_expiry_warning` | [Easterseals Iowa] Document Expiring Soon: Your BG check expires... |

### 8.3 Configuration

- Twilio credentials stored as **Supabase Edge Function secrets** (never in code)
- SMS toggle per-user in Settings (requires phone number)
- Trial account: only verified caller IDs can receive SMS
- Message format: `[Easterseals Iowa] {title}: {message preview, max 140 chars}`

---

## 9. Progressive Web App

### 9.1 Configuration

| Setting | Value |
|---------|-------|
| Plugin | vite-plugin-pwa 1.2.0 |
| Register Type | autoUpdate (seamless background updates) |
| Display | standalone (no browser chrome) |
| Orientation | portrait-primary |
| Theme Color | #006B3E (Easterseals green) |
| Background | #ffffff |

### 9.2 Caching Strategy

| Resource | Strategy | TTL |
|----------|----------|-----|
| Static assets (JS, CSS, HTML, images) | Precache | Build-versioned |
| Supabase API responses | NetworkFirst | 5 minutes, max 50 entries |
| Google Fonts CSS | CacheFirst | 1 year |
| Google Fonts WOFF2 | CacheFirst | 1 year |

### 9.3 Installation

- **iOS:** Safari > Share > "Add to Home Screen"
- **Android:** Chrome auto-prompt or Menu > "Install app"
- **Desktop Chrome:** Install icon in address bar

---

## 10. Volunteer Hours Letter

### 10.1 Feature

Volunteers can generate a professional PDF letter confirming their completed service hours. Available on the Shift History page.

### 10.2 Data Source

Only includes shifts where ALL of:
- `confirmation_status = 'confirmed'`
- `booking_status = 'confirmed'`
- `final_hours IS NOT NULL`
- `shift_date < today`

Button disabled when `profile.total_hours = 0`.

### 10.3 Letter Contents

- Easterseals Iowa letterhead (green #006B3E header, dot logo, address)
- "Volunteer Service Confirmation Letter" title
- Summary: volunteer name, total hours, service period, shift count
- Highlight box with key stats
- Detailed shift table: Date, Shift Title, Department, Hours
- Total row
- Admin signature (dynamically fetched from profiles where role = admin)
- Footer with reference ID and generation date

### 10.4 Technical Implementation

Uses browser print-to-PDF pattern (window.open + document.write + print). No external PDF library required. Clean A4 layout with `@media print` styles.

---

## 11. WordPress Landing Page

### 11.1 Environment

| Setting | Value |
|---------|-------|
| WordPress | 6.9.4 |
| Server | nginx + PHP 8.2.29 + MySQL 8.0.35 |
| Local Domain | easterseals-volunteer.local |
| Theme | Custom: `easterseals-landing` |
| CTA Links | https://easterseals-volunteer-scheduler.vercel.app |

### 11.2 Sections

1. **Top Bar** — Burnt orange (#cf4b04) "Part of the Easterseals National Network"
2. **Header** — Sticky nav, SVG logo, "Volunteer Portal" CTA button
3. **Hero** — Split layout: orange left (headline + 3 CTAs) | navy right (brand text)
4. **Stats Bar** — Navy background, 4 gold stat counters
5. **How It Works** — 4 step cards on beige background
6. **Departments** — 6 cards with SVG icons in 3x2 grid
7. **Features** — 2x2 grid with green dot accents
8. **CTA** — Navy section with sign-up/login buttons
9. **Footer** — 4-column: logo, quick links, contact, get involved

### 11.3 Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Navy | #1B2A4A | Hero right, stats, CTA, footer |
| Burnt Orange | #cf4b04 | Top bar, hero background, nav button, step circles |
| Bright Orange | #ffa300 | Accent icons, stat numbers, brand text, hovers |
| Rust | #b64204 | Deep hover states |
| Green | #006B3E | Easterseals brand, feature dots |
| Cream | #FFF5E6 | Button backgrounds |
| Beige | #F5EDE3 | Section backgrounds |

---

## 12. Security Hardening

### 12.1 Fixes Applied (Architecture Review)

| Issue | Severity | Fix |
|-------|----------|-----|
| Storage bucket access | Medium | Verified: volunteers scoped to `auth.uid()` folder, staff via `is_coordinator_or_admin()` |
| Messaging data leaks | High | RLS now checks `is_archived = false` on all message read/write policies |
| Bulk conversation privacy | High | Database trigger enforces max 2 participants on `conversation_type = 'bulk'` |
| Private notes access | Medium | Strict `volunteer_id = auth.uid()` — no `is_admin()` override |
| Document expiry stale status | Medium | `expire_documents()` runs daily via pg_cron, auto-transitions `approved -> expired` |
| Recommendation novelty bias | Low | Logarithmic decay with 0.3 floor; interaction count capped at 50 |
| Overbooking race condition | High | `validate_booking_slot_count()` trigger with `FOR UPDATE` row lock |
| Inactivity timeout false reset | Low | Already correct — only DOM events (mouse, keyboard, touch), not network |

### 12.2 Authentication Security

- Password strength enforcement (letter + number + 8 char minimum)
- Google OAuth as alternative provider
- Session auto-refresh with JWT
- Configurable inactivity timeout with warning countdown
- Email verification required for address changes

### 12.3 Data Protection

- All database access through RLS policies (no bypasses)
- File uploads scoped to user's own directory path
- Twilio credentials stored as Edge Function secrets
- Resend API key stored as Edge Function secret
- No sensitive data in URL parameters or client-side code

---

## 13. CI/CD & Deployment

### 13.1 Pipeline

```
Developer pushes to main branch
  --> GitHub Actions CI (lint, type-check, test)
  --> Vercel auto-build + CDN deployment
  --> Service worker auto-updates on next visit
```

### 13.2 Edge Function Deployment

```bash
npx supabase functions deploy <function-name> --project-ref esycmohgumryeqteiwla
```

Currently deployed: `send-email`, `send-sms`, `notification-webhook`, `delete-user`

### 13.3 Type Generation

```bash
npx supabase gen types typescript --project-id esycmohgumryeqteiwla > src/integrations/supabase/types.ts
```

Run after any schema change (new tables, columns, functions).

### 13.4 Environment Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Vercel env | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel env | Supabase anon key |
| `RESEND_API_KEY` | Supabase secret | Email delivery |
| `TWILIO_ACCOUNT_SID` | Supabase secret | SMS delivery |
| `TWILIO_AUTH_TOKEN` | Supabase secret | SMS auth |
| `TWILIO_PHONE_NUMBER` | Supabase secret | SMS sender number |

---

## 14. Codebase Metrics

| Metric | Count |
|--------|-------|
| Total source files (.ts/.tsx) | 122 |
| Page components | 25 |
| Custom components (non-UI) | 29 |
| shadcn/ui components | 53 |
| Custom hooks | 5 |
| Database tables | 27 |
| Database views | 1 |
| Database functions | 14 |
| Database triggers | 4 |
| Scheduled cron jobs | 2 |
| SQL migrations | 12 |
| Edge Functions | 4 |
| Storage buckets | 2 |
| Git commits | 60+ |

---

## 15. Known Limitations & Future Work

### 15.1 Current Limitations

| Item | Status | Notes |
|------|--------|-------|
| Twilio trial SMS | Active | Only verified numbers can receive SMS until account upgraded |
| Landing page hosting | Local only | Running on LocalWP; needs domain + production hosting |
| Bundle size | Warning | Main JS chunk ~940KB; code-splitting recommended |
| Email sandbox mode | Active | Resend emails redirect to admin inbox until domain verified |
| Document expiry reminders | Automated | pg_cron runs daily; no sub-day granularity |

### 15.2 Future Enhancements

- **Code splitting:** Lazy-load pages with `React.lazy()` + `Suspense` to reduce initial bundle
- **Push notifications:** Web Push API integration for real-time mobile alerts
- **Reporting dashboard:** Admin analytics with Recharts (hours by department, retention curves, compliance rates)
- **Calendar sync:** Two-way Google Calendar / Outlook integration
- **Multi-language:** i18n support for Spanish-speaking volunteers
- **Audit log:** Track all admin actions (role changes, document reviews, shift cancellations)

---

*Generated April 6, 2026 — Easterseals Iowa Volunteer Scheduler v4.0*
