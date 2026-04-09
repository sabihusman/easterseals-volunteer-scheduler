# Easterseals Iowa Volunteer Scheduler — Technical Specification

**Version:** 1.0
**Last updated:** 2026-04-09
**Owner:** sabihusman
**Repository:** https://github.com/sabihusman/easterseals-volunteer-scheduler

---

## 1. Overview

The Easterseals Iowa Volunteer Scheduler is a web application for managing volunteer shifts across multiple departments at Easterseals Iowa. It provides role-based workflows for volunteers to browse and book shifts, for coordinators to manage department schedules and confirm attendance, and for administrators to oversee the entire organization.

### 1.1 Goals

- Allow volunteers to discover, book, and manage shifts across the organization's service areas.
- Give department coordinators a scoped view of their own shifts and volunteer roster, with the ability to create shifts, confirm attendance, and message volunteers.
- Give administrators org-wide control: user management, department management, document compliance review, cross-department analytics, and org-wide policies.
- Enforce booking rules automatically through database triggers so that business invariants hold regardless of which client (web UI, future mobile app, or direct REST) performs the write.
- Send timely notifications (in-app, email, SMS) for shift reminders, confirmations, cancellations, and waitlist promotions.

### 1.2 Non-goals (current version)

- Payment processing / donations.
- Public-facing donation or fundraising pages.
- Integration with third-party volunteer-hour reporting systems.
- Native iOS/Android apps (the current Android build is a TWA wrapper around the web app).

---

## 2. Technology Stack

### 2.1 Frontend

| Layer | Technology | Version |
|---|---|---|
| Framework | React | 18.3 |
| Build tool | Vite | 5.4 |
| Language | TypeScript | 5.8 |
| Routing | react-router-dom | 6.30 |
| Data fetching | @tanstack/react-query | 5.83 |
| Forms | react-hook-form + zod | 7.61 / 3.25 |
| Styling | Tailwind CSS + tailwindcss-animate | 3.4 |
| UI components | shadcn/ui (Radix UI primitives) | — |
| Icons | lucide-react | 0.462 |
| Date handling | date-fns | 3.6 |
| Theme | next-themes | 0.3 (dark/light class toggle) |
| Charts | recharts | 2.15 |
| Calendar | react-day-picker | 8.10 |
| PWA | vite-plugin-pwa | 1.2 |

### 2.2 Backend / infrastructure

| Layer | Technology | Notes |
|---|---|---|
| Database | Supabase (PostgreSQL 15) | Project ref `esycmohgumryeqteiwla`, region `us-west-2` |
| Auth | Supabase Auth | Email/password, MFA (TOTP), Cloudflare Turnstile |
| Storage | Supabase Storage | Bucket: `volunteer-documents`, `shift-attachments` |
| Edge functions | Supabase Edge Runtime (Deno) | send-email, send-sms, notification-webhook, calendar-feed, delete-user, admin-act-on-behalf, admin-reset-mfa, mfa-recovery |
| Email | Resend / MailerSend | Configured per-deployment via edge function env |
| SMS | Twilio | `send-sms` edge function |
| Hosting | Vercel | Production: `https://easterseals-volunteer-scheduler.vercel.app` |
| Real-time | Supabase Realtime | Used for notifications, messages, unread counts |
| Cron | pg_cron | Waitlist offer expiry, shift reminders, unactioned shift cleanup, counter reconciliation |

### 2.3 Dev / CI

| Tool | Purpose |
|---|---|
| Bun | CI package install + test runner |
| Vitest (3.2) | Unit + integration tests (80 tests) |
| @testing-library/react | Component/hook testing |
| Playwright (1.57) | Browser-driving E2E tests (5 tests) |
| ESLint 9 | Linting (`--max-warnings=100`) |
| GitHub Actions | CI: lint + vitest + playwright + PR comment |
| Supabase CLI | Migration management and schema queries |

---

## 3. Architecture

### 3.1 High-level

```
┌──────────────────────────────────────────────────────────────┐
│                      Vercel (Frontend)                      │
│  React SPA + PWA service worker + TWA shell for Android     │
└─────────────────────────┬────────────────────────────────────┘
                          │ supabase-js (auth + REST + realtime)
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                        Supabase                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐ │
│  │   Auth   │  │ PostgreSQL │  │  Storage │  │   Edge     │ │
│  │ (GoTrue) │  │ + Realtime │  │ (objects)│  │ Functions  │ │
│  └──────────┘  └────────────┘  └──────────┘  └─────┬──────┘ │
└────────────────────────────────────────────────────┼────────┘
                                                     │
                  ┌──────────────────────────────────┼────────┐
                  ▼                                  ▼        │
            ┌──────────┐                    ┌──────────────┐  │
            │ Resend / │                    │    Twilio    │  │
            │MailerSend│                    │     (SMS)    │  │
            └──────────┘                    └──────────────┘  │
```

### 3.2 Request flows

**Read path (e.g. BrowseShifts page):**
1. React component mounts, reads `useAuth()` for current user session.
2. Component issues `supabase.from("shifts").select(...)` directly to PostgREST.
3. Supabase applies the `authenticated` JWT to evaluate RLS.
4. RLS policies filter rows to what the current user is allowed to see.
5. Results return to the component and render.

**Write path (e.g. volunteer books a shift):**
1. User clicks "Book" → `SlotSelectionDialog` opens.
2. On confirm, client issues `supabase.from("shift_bookings").insert(...)`.
3. PostgREST applies the insert INSERT policy (`volunteer_id = auth.uid()`).
4. `BEFORE INSERT` triggers fire: `enforce_booking_window`, `prevent_overlapping_bookings`, `enforce_volunteer_role`.
5. `INSERT` proceeds if triggers allow.
6. `AFTER INSERT` triggers fire: `validate_booking_slot_count` (may demote to waitlisted if full), `sync_booked_slots`, `trg_recalculate_consistency`.
7. Row is returned (possibly with updated booking_status) via `RETURNING`.

**Notification path (e.g. new message):**
1. Client inserts into `notifications`.
2. A database webhook (Supabase extension) posts the row to the `notification-webhook` edge function.
3. The edge function loads the recipient's `profiles` row, checks per-type opt-out preferences (`notif_new_messages`, `notif_shift_reminders`, etc.).
4. If email is allowed, posts to the `send-email` edge function with a template payload.
5. If SMS is allowed AND the recipient has a phone number, posts to the `send-sms` edge function.
6. Real-time subscription on the client updates the NotificationBell without a full fetch.

---

## 4. User Roles

Three roles enforced by the `user_role` enum on `profiles.role`:

| Role | Capabilities |
|---|---|
| **volunteer** | Browse shifts within their booking window, book/cancel own bookings, view own shift history, upload required documents, view own private notes, send/receive messages, manage own profile, view own impact charts |
| **coordinator** | Everything a volunteer can do (except via their own profile) + manage shifts in their assigned departments, confirm volunteer attendance for their departments, view volunteers who have booked in their departments, send direct and bulk messages within scope, view limited reports scoped to their departments |
| **admin** | Full org-wide access: all coordinator capabilities across all departments + user management, department management, document type management, document compliance review, cross-department reports, org-wide settings, reminder management |

### 4.1 Role caps

- **Admin cap** is 2. `profiles` cannot have more than 2 rows with `role = 'admin'`. Enforced in `AdminUsers.tsx` UI and should be enforced by a DB trigger as well.
- **Coordinators** can be assigned to multiple departments via the `department_coordinators` join table.
- **Volunteer ↔ department** is not a direct assignment — volunteers have access to any department's open shifts (subject to document compliance, restrictions, and the booking window).

---

## 5. Data Model

### 5.1 Core entities

```
profiles ─────────┬──> department_coordinators ──> departments
      │           │                                     │
      │           └──> shift_bookings ─────> shifts ─────┤
      │                      │                          │
      │                      └──> shift_booking_slots ─> shift_time_slots
      │                                                  (auto-generated)
      └──> volunteer_documents ──> document_types
      └──> volunteer_private_notes ─────────────> shifts
      └──> conversation_participants ──> conversations
                                              └──> messages
      └──> notifications
```

### 5.2 Key tables

#### `profiles`

Stores all user metadata. One row per authenticated user. Keyed by `id` (uuid, FK to `auth.users`).

Key columns:
- `id` uuid PK
- `email`, `username`, `full_name`, `phone` text
- `role` user_role enum (volunteer | coordinator | admin)
- `is_active` boolean — admin can deactivate
- `booking_privileges` boolean — admin can revoke
- `messaging_blocked` boolean — admin can mute
- `bg_check_status` enum (pending | cleared | failed | expired)
- `bg_check_expires_at` timestamptz
- `emergency_contact_name`, `emergency_contact_phone` text
- `consistency_score` int (0-100, 5-shift rolling window)
- `extended_booking` boolean (90% consistency unlocks 21-day booking window)
- `volunteer_points` int (sum of confirmed hours × multipliers)
- `onboarding_complete` boolean
- `tos_accepted_at` timestamptz
- `notif_shift_reminders`, `notif_new_messages`, `notif_booking_changes`, `notif_milestone`, `notif_document_expiry` boolean (per-type opt-outs)
- `notif_email`, `notif_sms` boolean (global opt-outs)
- `mfa_enabled`, `mfa_secret`, `mfa_backup_codes` — for TOTP MFA

#### `departments`

Top-level org unit a shift belongs to.

- `id` uuid PK
- `name` text
- `description` text
- `requires_bg_check` boolean (departments can require BG check org-wide)
- `is_active` boolean

#### `department_coordinators`

Many-to-many between coordinators and departments.

- `coordinator_id` uuid FK → profiles
- `department_id` uuid FK → departments

#### `shifts`

A specific time slot at a department that volunteers can book.

- `id` uuid PK
- `title` text
- `description` text
- `department_id` uuid FK
- `created_by` uuid FK → profiles (**NOT NULL**, must be passed by client)
- `shift_date` date
- `time_type` text (custom | morning | afternoon | evening | full-day)
- `start_time`, `end_time` time
- `total_slots` int
- `booked_slots` int (maintained by trigger; equals count of confirmed `shift_bookings`)
- `status` text (open | full | cancelled | completed)
- `requires_bg_check` boolean
- `coordinator_note` text
- `is_recurring` boolean + `recurrence_rule` text (RRULE format)
- `allows_group` boolean, `max_group_size` int

#### `shift_time_slots`

Auto-generated sub-slots for shifts longer than 4 hours. Volunteers can book individual 2-hour chunks.

- `id` uuid PK
- `shift_id` uuid FK
- `slot_start`, `slot_end` time
- `total_slots` int
- `booked_slots` int (maintained by trigger)

**Write access** is locked down: restrictive RLS policies `deny client insert`, `deny client update`, `deny client delete` apply to `authenticated`. Only `SECURITY DEFINER` trigger functions can modify this table.

#### `shift_bookings`

A volunteer's commitment to work a shift.

- `id` uuid PK
- `shift_id` uuid FK
- `volunteer_id` uuid FK
- `booking_status` text (confirmed | waitlisted | cancelled)
- `confirmation_status` text (pending_confirmation | confirmed | no_show)
- `final_hours` numeric (set when coordinator/admin confirms attendance)
- `waitlist_offer_expires_at` timestamptz (set when a waitlisted volunteer is offered a promoted slot; 2-hour window)
- `promoted_at` timestamptz
- `cancelled_at` timestamptz
- `late_cancel_notified` boolean (true if cancelled < 12 h before shift)
- `checked_in_at` timestamptz

#### `shift_booking_slots`

Sub-slot assignments when a booking uses the fine-grained slot selection.

- `booking_id` uuid FK → shift_bookings
- `slot_id` uuid FK → shift_time_slots
- `shift_id` uuid FK → shifts (denormalized for RLS performance)

#### `volunteer_shift_reports`

Volunteer-submitted hour reports after a shift.

- `id` uuid PK
- `shift_id` uuid FK
- `volunteer_id` uuid FK
- `hours_submitted` numeric
- `rating` int (1-5)
- `comment` text

#### `volunteer_private_notes`

Notes a volunteer writes to themselves. **Private to the owning volunteer** — no admin read access by design.

- `id` uuid PK
- `volunteer_id` uuid FK
- `shift_id` uuid FK (nullable — supports standalone notes)
- `department_id` uuid FK
- `title` text
- `body` text
- `is_locked` boolean (notes auto-lock 7 days after creation)

#### `volunteer_documents`

Uploaded documents (certifications, signed waivers, etc.).

- `id` uuid PK
- `volunteer_id` uuid FK
- `document_type_id` uuid FK
- `file_path` text (Supabase Storage key)
- `status` text (pending_review | approved | rejected)
- `expires_at` timestamptz
- `reviewed_by` uuid FK (admin only)
- `reviewed_at` timestamptz
- `rejection_reason` text

#### `conversations`, `conversation_participants`, `messages`

Two-party and group messaging.

- `conversations.conversation_type` text (direct | bulk)
- `conversation_participants` includes a `cleared_at` timestamptz — local "delete conversation" that hides messages created before that timestamp for that user only.
- `messages.is_read` tracked via the recipient's `conversation_participants.last_read_at`.

#### `notifications`

In-app notifications; a subset are routed to email/SMS via the webhook.

- `user_id` uuid FK
- `title`, `message` text
- `type` text (see §8.3)
- `link` text (relative URL)
- `is_read` boolean
- `data` jsonb (additional template payload for email/SMS)

### 5.3 Computed fields and triggers

Business rules are enforced by PostgreSQL triggers, not application code. Clients can insert or update freely within RLS; triggers will correct or reject.

| Trigger | Table | Purpose |
|---|---|---|
| `trg_generate_time_slots` | shifts | Auto-create `shift_time_slots` rows when a shift is inserted (SECURITY DEFINER) |
| `trg_shift_status` | shifts | Update `status` based on `booked_slots` vs `total_slots` (open → full → cancelled) |
| `trg_shifts_updated_at` | shifts | Maintain updated_at |
| `trg_cleanup_notifications_on_shift_delete` | shifts | Remove dangling notifications on hard delete |
| `validate_booking_slot_count` | shift_bookings | Enforce capacity; demote new bookings to waitlisted if shift is full; recount from base row with FOR UPDATE lock |
| `sync_booked_slots` | shift_bookings | Keep `shifts.booked_slots` equal to real count of confirmed bookings (SECURITY DEFINER) |
| `trg_waitlist_promote_on_cancel` | shift_bookings | When a confirmed booking cancels, offer the next waitlisted volunteer a 2-hour acceptance window |
| `trg_waitlist_promote_on_delete` | shift_bookings | Same as above but on hard DELETE |
| `prevent_overlapping_bookings` | shift_bookings | Reject a booking if the volunteer already has a confirmed booking on the same date and overlapping time |
| `enforce_booking_window` | shift_bookings | Reject a booking more than 14 days out (or 21 days if `extended_booking = true`). Also enforces BG check. Also rejects past-dated bookings. |
| `enforce_volunteer_role` | shift_bookings | Reject bookings where the booker's role is not `volunteer` |
| `trg_recalculate_consistency` | shift_bookings | Recompute volunteer's `consistency_score` and `extended_booking` flag after any booking state change |
| `has_active_booking_on(uuid)` | function | SECURITY DEFINER helper used by RLS to avoid policy recursion |

### 5.4 Cron jobs (pg_cron)

| Job | Schedule | Purpose |
|---|---|---|
| `waitlist-offer-expire` | `*/5 * * * *` | Delete waitlist offers where `waitlist_offer_expires_at < now()`; promote next waitlisted volunteer |
| Shift reminders | per-booking | Send 1-day and 1-hour-before reminders |
| Unactioned shift reminder | daily | Email volunteer + coordinator when a shift is 48+ hours past with no confirmation |
| Counter reconciliation | hourly | Self-heal any drift between `shifts.booked_slots` and real confirmed count |

---

## 6. Authentication & Authorization

### 6.1 Authentication

- **Identity provider:** Supabase Auth (GoTrue)
- **Methods:** email + password; username + password (via `get_email_by_username` RPC)
- **Bot protection:** Cloudflare Turnstile on all auth forms (register, login, forgot password)
- **MFA:** TOTP (RFC 6238). Stored via `mfa_secret` on `profiles`. 10 recovery codes per user. Enrollment is optional for volunteers, recommended for coordinators, required for admins (enforcement should be added as a DB check).
- **Session persistence:** Supabase-js stores access/refresh tokens in `localStorage` under `sb-<project-ref>-auth-token`. Sessions auto-refresh before expiry.
- **Password reset:** Standard Supabase flow via email.
- **Registration:** New users are created with `is_active = false`. An admin must activate them before they can book shifts. The initial welcome email is sent from the `registration_welcome` template.

### 6.2 Row-Level Security (RLS)

Every public table has RLS enabled. Representative policies:

**`profiles`**
- `profiles: own read` — users can read their own row
- `profiles: admin read` — admins can read all
- `profiles: coordinator read dept volunteers` — coordinators can read volunteers who have booked in their departments (via `department_coordinators` join, SECURITY DEFINER helper)
- `profiles: volunteer read admins and dept coordinators` — volunteers can read admins always, and coordinators for departments where they have any booking
- `profiles: own update` — users update their own row
- `profiles: admin update any` — admins update any row

**`shifts`**
- Public SELECT for authenticated users (filtered by booking window on the client)
- INSERT allowed for coordinators of the shift's department, or admins
- UPDATE allowed for same
- DELETE allowed for admins only (or coordinators for their own departments)

**`shift_bookings`**
- SELECT: own rows, coordinators see bookings in their departments, admins see all
- INSERT: volunteer_id must equal auth.uid() (with trigger-level checks for role, window, overlap, bg check)
- UPDATE: own rows (for cancellation), coordinators of the department (for confirmation), admins

**`volunteer_documents`**
- INSERT / SELECT own — volunteer
- SELECT all — coordinators and admins
- **UPDATE (review) — admin only** (tightened in this session; was previously coordinator-or-admin)

**`volunteer_private_notes`**
- SELECT / INSERT / UPDATE / DELETE — owner only. **No admin read access** (intentional; notes are private).

**`conversations` / `messages`**
- Participants can read their own conversations. Creator can read the row they just inserted (added to allow `.insert().select()` round-trip).

**`notifications`**
- SELECT / UPDATE — own only
- INSERT — admins and coordinators (scoped to their departments), volunteers can self-insert
- Admin read all

**`shift_time_slots`**
- SELECT: public (authenticated)
- INSERT / UPDATE / DELETE: **restrictive deny** on `authenticated`. Only SECURITY DEFINER trigger functions mutate this table.

### 6.3 Role helper functions

- `is_admin()` — `SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')`
- `is_coordinator_or_admin()` — same with `role IN ('coordinator', 'admin')`
- `is_coordinator_for_my_dept(uuid)` — checks if a given coordinator has any booking-shared department with the caller (used by volunteer → coordinator profile lookup)
- `has_active_booking_on(uuid)` — SECURITY DEFINER helper to avoid RLS recursion when shifts reference shift_bookings

---

## 7. Features

### 7.1 Volunteer features

- **Dashboard** (`/dashboard`): upcoming bookings, quick actions, onboarding checklist, impact charts (6-month hours + attendance)
- **Browse shifts** (`/shifts`): list and calendar view, filter by department + time range, waitlist indicator, recommended shifts (based on booking history), booking window messaging
- **My shifts / history** (`/history`): past bookings with hours, attendance, ratings submitted
- **Shift confirmation** (`/my-shifts/confirm/:bookingId`): self-confirm attendance + submit hours + rate the shift after it's ended
- **My notes** (`/notes`): private notes linked to shifts/departments; auto-lock after 7 days
- **Documents** (`/documents`): upload required documents; see status (pending review, approved, rejected, expired)
- **Events** (`/events`): RSVP to volunteer events (non-shift gatherings)
- **Messages** (`/messages`): direct messages with coordinators and admins; receive bulk messages
- **Settings** (`/settings`): profile, phone, emergency contact, notification preferences, MFA setup, theme toggle

### 7.2 Coordinator features

All volunteer features (through their own profile if they choose to volunteer) plus:

- **Coordinator dashboard** (`/coordinator`): tabs for Shifts, Volunteer Activity, Volunteers in their departments; low-coverage alerts; department selector (for multi-department coordinators)
- **Manage shifts** (`/coordinator/manage`): create / edit / cancel shifts in their departments
- **Unactioned shifts** (`/admin/unactioned-shifts`): shifts that have ended without volunteer confirmation; manual close-out
- **Reports** (`/reports`): popularity, ratings, attendance, department rollup (scoped to their departments)
- **Direct messaging** and **bulk messaging** to volunteers who have booked in their departments

### 7.3 Admin features

All coordinator features org-wide plus:

- **Admin dashboard** (`/admin`): cross-department shift list, leaderboard, department assignment management, cancel/delete any shift
- **User management** (`/admin/users`): activate/deactivate, role changes, BG check updates, booking privilege toggles, messaging block, delete user (calls `delete-user` edge function for auth + cascade cleanup)
- **Departments** (`/admin/departments`): create / edit / deactivate departments, assign coordinators
- **Events** (`/admin/events`): create / manage org-wide volunteer events
- **Settings** (`/admin/settings`): org-wide policy toggles
- **Document types** (`/admin/documents`): define what documents are required (certificates, waivers, etc.), expiry periods
- **Document compliance** (`/admin/compliance`): review uploaded documents, approve/reject, mark expired
- **Reminders** (`/admin/reminders`): view pending confirmation reminders, manually mark attended/no-show
- **Reports** (`/reports`): org-wide analytics

### 7.4 Booking lifecycle

```
             ┌──────────┐
             │  (none)  │
             └────┬─────┘
                  │ volunteer clicks "Book"
                  ▼
       ┌─────────────────────┐
       │     confirmed       │◄──────────┐
       └──┬────────────┬─────┘           │
          │            │                 │
  cancel  │            │ shift full      │ waitlist_accept
          ▼            ▼                 │
    ┌──────────┐  ┌──────────────┐      │
    │cancelled │  │  waitlisted  │──────┘
    └──────────┘  │ (with offer) │
                  └──────────────┘
```

Allowed transitions:
- `(none) → confirmed` — normal booking path; trigger may demote to `waitlisted` if full
- `confirmed → cancelled` — volunteer self-cancel
- `waitlisted → confirmed` — via `waitlist_accept()` RPC (must have active offer)
- `waitlisted → cancelled` — via `waitlist_decline()` RPC
- `cancelled → waitlisted` — re-activation when a previously-cancelled row is reused by a new booking attempt

Forbidden transitions:
- `cancelled → confirmed` directly (must go through waitlist)
- `confirmed → waitlisted` via client (only the validate_booking_slot_count trigger can do this on overbook)

### 7.5 Consistency score and booking window

- Every volunteer has a `consistency_score` (0-100) computed over their last 5 bookings.
- `attended = count where booking_status != 'cancelled' AND confirmation_status != 'no_show'`
- `score = round(attended / min(bookings, 5) * 100)`
- Score is recalculated by trigger `trg_recalculate_consistency` whenever a booking's status changes.
- `extended_booking = true` when `score >= 90` AND `count(bookings) >= 5`
- Booking window: 14 days default, 21 days if `extended_booking = true`. Enforced by `enforce_booking_window` trigger.

### 7.6 Waitlist promotion flow

1. Volunteer A books a full shift → demoted to `waitlisted` by trigger (no offer yet).
2. A confirmed volunteer cancels their booking.
3. `trg_waitlist_promote_on_cancel` selects the next `waitlisted` booking ordered by `created_at ASC`, sets `waitlist_offer_expires_at = now() + 2 hours`, and inserts a `waitlist_offer` notification.
4. Volunteer A receives the notification (in-app + email + SMS depending on prefs).
5. Volunteer A calls `waitlist_accept(booking_id)` → `booking_status → confirmed`.
6. If Volunteer A doesn't respond within 2 hours, the `waitlist-offer-expire` cron job (runs every 5 minutes) deletes the offer row and calls `promote_next_waitlist()` for the next person.

### 7.7 Notifications

Notification types (not exhaustive):

| Type | Trigger | Channels |
|---|---|---|
| `booking_confirmed` | Volunteer books or is promoted from waitlist | in-app + email + SMS |
| `booking_cancelled` | Volunteer cancels own booking | in-app + email |
| `shift_cancelled` | Admin/coordinator cancels an entire shift | in-app + email + SMS |
| `shift_reminder` | 1 day / 1 hour before shift | in-app + email + SMS |
| `self_confirmation_reminder` | Shift has ended, volunteer hasn't confirmed | in-app + email |
| `unactioned_shift_reminder` | 48+ hours past end, still unactioned | in-app + email |
| `unactioned_shift_coord_reminder` | Same as above, sent to coordinators | email |
| `late_cancellation` | Volunteer cancels < 12 hours before shift | in-app + email to coordinator |
| `waitlist_offer` | Promoted from waitlist, 2-hour window | in-app + email + SMS |
| `waitlist_offer_expired` | Offer not accepted in 2 hours | in-app |
| `new_message` | Message received | in-app + email (preference-gated) |
| `document_expired` | Uploaded document has expired | in-app + email |
| `document_expiry_warning` | Document expiring soon | in-app + email |
| `bg_check_status_change` | Admin updates BG check status | in-app + email |
| `hours_milestone` | Crossed a volunteer-hours milestone | in-app + email |

Each notification type respects the per-type opt-out preference on `profiles` (e.g. `notif_booking_changes`, `notif_shift_reminders`, `notif_new_messages`, `notif_document_expiry`, `notif_milestone`), plus the global `notif_email` and `notif_sms` toggles.

---

## 8. Edge functions

All edge functions live in `supabase/functions/<name>/index.ts`.

### 8.1 `send-email`

Sends templated transactional email via Resend (or MailerSend, configurable). Template dispatch is by `type` string.

**Config (via edge function secrets):**
- `RESEND_API_KEY` (or `MAILERSEND_API_KEY`)
- `EMAIL_SANDBOX` — when `true`, all outgoing email is redirected to `EMAIL_SANDBOX_REDIRECT`. **Must be unset or `false` in production.**
- `EMAIL_SANDBOX_REDIRECT` — test inbox for sandbox mode

**Templates (partial list):** `shift_booked`, `shift_cancelled`, `booking_cancelled`, `shift_reminder`, `self_confirmation_reminder`, `unactioned_shift_reminder`, `unactioned_shift_coord_reminder`, `coordinator_confirmation_reminder`, `admin_escalation`, `late_cancellation`, `waitlist_offer`, `waitlist_offer_expired`, `waitlist_notification`, `hours_milestone`, `registration_welcome`, `password_reset`, `new_message`, `document_expired`, `document_expiry_warning`, `bg_check_status_change`

Unknown types log a warning and return `null` (no crash).

### 8.2 `send-sms`

Sends SMS via Twilio. Takes a `to` phone number, `body` text, and optional `notification_id`.

**Config:**
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Body is truncated to 1600 characters (Twilio limit). **Known limitation:** falls back to `emergency_contact_phone` when `profile.phone` is null — should be reviewed for privacy.

### 8.3 `notification-webhook`

Supabase webhook receiver. Fires on `INSERT` to `notifications`. Routes the notification to `send-email` and/or `send-sms` based on:

1. Whether the `type` is in the hard-coded `typeMap` (only listed types are emailed/SMS'd).
2. The user's per-type preference column (`typePrefs` mapping).
3. The user's global `notif_email` / `notif_sms` flags.
4. Whether the user has the required contact info (verified email / phone).

### 8.4 `delete-user`

Admin-only function. Cascades deletion across `profiles`, `auth.users`, and all FK'd rows. Requires admin service_role bearer.

### 8.5 `admin-act-on-behalf`

Lets an admin temporarily impersonate a volunteer for support purposes (e.g. book a shift on their behalf). Logs the action to `admin_action_log`.

### 8.6 `admin-reset-mfa`

Lets an admin clear a user's MFA secret when they've lost their device.

### 8.7 `mfa-recovery`

Validates a user's backup code and disables MFA if correct.

### 8.8 `calendar-feed`

Returns an `.ics` calendar feed of a volunteer's upcoming shifts. Authenticated via a per-user `calendar_token` (separate from auth session, so the URL can be subscribed to from a calendar app).

---

## 9. Deployment

### 9.1 Frontend (Vercel)

- **Repo:** `sabihusman/easterseals-volunteer-scheduler`
- **Branch:** `main` auto-deploys to production (`https://easterseals-volunteer-scheduler.vercel.app`)
- **Preview:** every PR branch gets a Vercel preview deployment
- **Build command:** `vite build`
- **Output directory:** `dist`
- **Env vars (Vercel):**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`

### 9.2 Backend (Supabase)

- **Project ref:** `esycmohgumryeqteiwla`
- **Region:** us-west-2
- **Migrations:** stored in `supabase/migrations/*.sql`. Most early migrations were applied out-of-band via the Supabase SQL editor and are not tracked in the remote `schema_migrations` table. Going forward, apply via `npx supabase db query --linked -f <file>` or via the SQL editor.
- **Edge functions:** deployed via `npx supabase functions deploy <name>`. Do NOT auto-deploy from git.

**Edge function secrets (set via `npx supabase secrets set`):**
- `RESEND_API_KEY` or `MAILERSEND_API_KEY`
- `EMAIL_SANDBOX` (default unset in prod)
- `EMAIL_SANDBOX_REDIRECT` (only if sandbox on)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`

### 9.3 Android (TWA)

The app is wrapped as a Trusted Web Activity for Google Play. See `docs/sprint4-android-setup.md` and `docs/play-store-listing.md` for setup.

---

## 10. Testing

### 10.1 Unit + integration (Vitest)

Location: `src/**/__tests__/**/*.test.{ts,tsx}`, `src/test/*.test.ts`

**Current count:** 80 tests across 7 files.

Coverage highlights:
- `parseShiftDate` — 11 tests (DST boundaries, leap years, timezone off-by-one)
- Booking status transitions — 11 tests (state-machine validation)
- Consistency score / 21-day window — 16 tests (90% threshold boundary)
- `useUnreadCount` hook — 6 tests (single-subscription invariant, clean unmount)
- Booking rules, slot utilities, admin cap, department restriction filtering — 36 tests total

**Run locally:**
```bash
npm run test         # single run
npm run test:watch   # watch mode
```

### 10.2 End-to-end (Playwright)

Location: `tests/e2e/*.spec.ts`

**Current count:** 5 browser-driving tests.

Coverage:
- `01-volunteer-books-shift.spec.ts` — UI smoke load + REST booking path + counter invariant
- `02-waitlist-promotion.spec.ts` — A books, B waitlisted, A cancels, B promoted, B accepts
- `03-coordinator-confirms-attendance.spec.ts` — past shift, volunteer books, coordinator confirms via REST
- `04-admin-delete-shift.spec.ts` — admin hard-delete with active bookings; asserts zero orphan rows

**Run locally:**
```bash
SUPABASE_URL=https://esycmohgumryeqteiwla.supabase.co \
SUPABASE_ANON_KEY=<anon-key> \
TEST_VOLUNTEER_EMAIL=<...> \
TEST_VOLUNTEER_2_EMAIL=<...> \
TEST_COORDINATOR_EMAIL=<...> \
TEST_ADMIN_EMAIL=<...> \
TEST_PASSWORD=<password> \
npm run test:e2e
```

**Note:** tests hit the live production database. Each test creates a uniquely-titled shift, runs its assertions, and cleans up in `afterAll`. A stray failed test can leave test shifts behind.

### 10.3 CI pipeline

`.github/workflows/ci.yml` runs three jobs on every push and PR:

1. **Lint + Vitest** — ESLint + `bunx vitest run`. Blocks merge on any failure.
2. **Playwright E2E** — runs the browser suite against production. Needs `lint-and-unit` to pass first. Blocks merge on any failure.
3. **Comment test results on PR** — posts a collapsible results table with outputs from both previous jobs.

**Required GitHub Actions secrets:**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TEST_VOLUNTEER_EMAIL`, `TEST_VOLUNTEER_2_EMAIL`, `TEST_COORDINATOR_EMAIL`, `TEST_ADMIN_EMAIL`, `TEST_PASSWORD`

### 10.4 Contributing workflow

- Every change goes on a `fix/<description>` or `feature/<description>` branch.
- No direct pushes to `main`.
- Every branch gets a PR + must pass CI before merge.
- Squash-merge is the default merge strategy.

---

## 11. Monitoring and observability

**Current state:** no dedicated error monitoring or user analytics.

- **Frontend errors:** visible in the browser console only. No Sentry / LogRocket / Rollbar.
- **Backend errors:** Supabase dashboard logs (retention: 7 days on free tier, 30 days on Pro).
- **Edge function logs:** Supabase dashboard → Edge Functions → Logs.
- **Database queries:** Supabase dashboard → Database → Query Performance.

**Recommendation:** wire Sentry (or equivalent) for frontend + edge functions before real user traffic. See §13 for launch checklist.

---

## 12. Known limitations and deferred items

The following items were identified in the April 2026 full-scale audit but were not addressed in that round. They're documented here so future iterations can pick them up.

### 12.1 Correctness

- **BulkComposeMessage department filter** (`src/components/messaging/BulkComposeMessage.tsx`): the UI exposes a department filter but the filter is never applied to the recipient query. Coordinators could inadvertently bulk-message volunteers outside their assigned departments.
- **Reports department rollup** (`20260407_reports_functions.sql`): does not exclude cancelled shifts, whereas the per-shift view does. Totals may differ between the two views.
- **Reports popularity** is not time-bounded. Historical waitlist counts from 6+ months ago still contribute to the "most popular shifts" ranking.
- **`prevent_overlapping_bookings`** uses strict-less-than (`<` / `>`) for time comparison, so a booking ending at exactly 12:00 and another starting at exactly 12:00 are not considered overlapping. Intentional but worth confirming with Easterseals' operational definition.

### 12.2 User experience

- **ConversationThread auto-scroll** — `scrollRef.current.scrollTop = scrollRef.current.scrollHeight` assumes the ref points at the scroll container, but shadcn `ScrollArea` wraps a viewport div. New messages may not auto-scroll to the bottom.
- **`cleared_at` uses `>` instead of `>=`** — a rare edge case where a message sent in the same millisecond as the user's conversation-clear action would not reappear.
- **Notes auto-lock** — the 7-day lock is computed frontend-only. If a user opens the app with stale state, a note may appear editable after the 7-day window.
- **Invitation email URL** is hardcoded to the production Vercel domain. Breaks on custom-domain cutover.

### 12.3 Notifications

- **`bg_check_status_change`, `shift_invitation`, `admin_escalation`, `coordinator_confirmation_reminder`** types lack a preference-column mapping in the webhook. They always send regardless of user opt-out.
- **`coordinator_confirmation_reminder`** type has a template but is never actually created anywhere in the codebase. Dead code.
- **SMS emergency-contact fallback** — when `profile.phone` is null, `send-sms` falls back to `emergency_contact_phone` without explicit user consent. Privacy concern.
- **`new_message`** preference check is inconsistent with the other types — the mapping is there but the guard order is different.

### 12.4 Performance

- **VolunteerLeaderboard N+1 query** — when the current user is outside the top 10, the component issues two additional count queries to compute their rank. Would benefit from a single window-function RPC.
- No indexes have been verified against query-plan profiles under realistic data volume. Worth running `EXPLAIN ANALYZE` on the heaviest pages once production data accumulates.

### 12.5 Operational

- **AdminReminders page** is read-only. Admins can't manually re-trigger a reminder from the UI if a cron misses one.
- **No admin escalation path** if both of the 2 allowed admins become unavailable (lose MFA device, etc.). Mitigated by `admin-reset-mfa` edge function but requires service-role access.
- **No data retention policy** — messages, notifications, booking history accumulate indefinitely.

---

## 13. Pre-launch checklist

Before Easterseals greenlights general availability:

### Blockers

- [ ] **Disable `EMAIL_SANDBOX`** in edge function secrets. Confirm a real transactional email (welcome / booking confirmation) lands in a real inbox.
- [ ] **Verify email sending domain** — SPF, DKIM, DMARC records published and matching the Resend / MailerSend domain.
- [ ] **Smoke test full volunteer journey end-to-end** as a new user: register → admin activates → book shift → receive confirmation email → receive reminder email → attend → confirm hours → rate.
- [ ] **Smoke test SMS delivery** with a real phone number.
- [ ] **Wire error monitoring** (Sentry or equivalent) for frontend + edge functions.
- [ ] **Review §12 deferred audit items** with Easterseals; decide which are launch blockers.

### Legal / compliance

- [ ] **Privacy Policy** at `/privacy` reviewed by Easterseals legal.
- [ ] **Terms of Service** — add a flow if required by Easterseals.
- [ ] **HIPAA / sensitive-population requirements** — confirm volunteer interactions with clients don't trigger regulated-data requirements. If they do, sign a BAA with Supabase.
- [ ] **Data retention policy** defined and implemented (automatic purge after N months for messages, notifications, etc.).
- [ ] **Accessibility** (WCAG 2.1 AA) — shadcn is accessible by default but the custom booking flow should be verified with a screen reader.

### Operational

- [ ] **Backup strategy** — enable paid-tier Supabase backups with retention matching Easterseals' requirements.
- [ ] **Runbook documented** for Easterseals staff: password reset, unblock user, cancel shift on behalf of volunteer, process document compliance, reset MFA.
- [ ] **Admin escalation path** — at least 2 active admin accounts with MFA enrolled, backup codes stored securely.
- [ ] **Load test** — simulate expected peak (e.g. 50-100 volunteers refreshing `/shifts` simultaneously) against Supabase tier.
- [ ] **Incident response plan** — who to contact when something breaks, how to roll back a bad deploy (Vercel instant rollback is available).

### Nice-to-have (not blockers)

- [ ] Tackle the §12 deferred items.
- [ ] Wire Vercel preview URL detection in CI for per-PR E2E runs.
- [ ] Add a data export flow ("download all my volunteer data") for GDPR-style requests.

---

## 14. Directory layout

```
easterseals-volunteer-scheduler/
├── .github/
│   └── workflows/ci.yml       # lint + vitest + playwright + PR comment
├── docs/
│   ├── TECH_SPEC.md           # this file
│   ├── play-store-listing.md
│   └── sprint4-android-setup.md
├── e2e/                       # legacy REST-only Playwright tests
│   ├── booking-lifecycle.spec.ts
│   └── playwright.config.ts
├── public/                    # static assets, PWA manifest, service worker
├── src/
│   ├── components/            # shared components
│   │   ├── messaging/         # ConversationList, ConversationThread, ComposeMessage
│   │   ├── ui/                # shadcn primitives
│   │   ├── AppLayout.tsx      # shell with header, sidebar, mobile nav
│   │   ├── AppSidebar.tsx
│   │   ├── MobileNav.tsx
│   │   ├── NotificationBell.tsx
│   │   ├── OnboardingModal.tsx
│   │   ├── SlotSelectionDialog.tsx
│   │   ├── VolunteerImpactCharts.tsx
│   │   └── ... (30+ more)
│   ├── contexts/
│   │   └── AuthContext.tsx
│   ├── hooks/
│   │   ├── useUnreadCount.ts
│   │   └── use-mobile.tsx
│   ├── integrations/supabase/ # generated client + types
│   ├── lib/                   # pure utilities
│   │   ├── calendar-utils.ts  # parseShiftDate, downloadCSV
│   │   ├── slot-utils.ts
│   │   └── __tests__/         # Vitest unit tests
│   ├── pages/                 # top-level routes
│   │   ├── Auth.tsx
│   │   ├── VolunteerDashboard.tsx
│   │   ├── BrowseShifts.tsx
│   │   ├── ShiftHistory.tsx
│   │   ├── CoordinatorDashboard.tsx
│   │   ├── ManageShifts.tsx
│   │   ├── AdminDashboard.tsx
│   │   ├── AdminUsers.tsx
│   │   ├── AdminDepartments.tsx
│   │   ├── AdminEvents.tsx
│   │   ├── AdminDocumentTypes.tsx
│   │   ├── DocumentCompliance.tsx
│   │   ├── Reports.tsx
│   │   ├── Messages.tsx
│   │   ├── MyNotes.tsx
│   │   ├── Settings.tsx
│   │   └── ... (28 total)
│   ├── test/
│   │   └── setup.ts           # Vitest global setup (jest-dom, matchMedia polyfill)
│   ├── App.tsx                # route definitions
│   ├── main.tsx               # ThemeProvider + React root
│   └── index.css              # Tailwind + CSS variables (light + dark palettes)
├── supabase/
│   ├── config.toml
│   ├── functions/             # edge functions
│   │   ├── send-email/
│   │   ├── send-sms/
│   │   ├── notification-webhook/
│   │   ├── delete-user/
│   │   ├── calendar-feed/
│   │   ├── admin-act-on-behalf/
│   │   ├── admin-reset-mfa/
│   │   └── mfa-recovery/
│   └── migrations/            # 60+ SQL migrations
├── tests/
│   └── e2e/                   # browser-driving Playwright tests (2026-04)
│       ├── playwright.config.ts
│       ├── fixtures/
│       │   ├── session.ts     # Supabase auth helpers
│       │   └── db.ts          # REST setup/teardown/verification
│       ├── 01-volunteer-books-shift.spec.ts
│       ├── 02-waitlist-promotion.spec.ts
│       ├── 03-coordinator-confirms-attendance.spec.ts
│       └── 04-admin-delete-shift.spec.ts
├── index.html
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── playwright.config.ts
```

---

## 15. Change history

| Date | Change | Commit |
|---|---|---|
| 2026-04-09 | Clean-slate DB wipe (shifts, bookings, notifications, messages, notes) | via supabase db query |
| 2026-04-09 | generate_shift_time_slots → SECURITY DEFINER (critical prod fix) | `cdc90c4` |
| 2026-04-09 | Full test suite merged: Vitest + Playwright + CI gates | `982d813` |
| 2026-04-09 | Full-scale audit round 1 — 12 bugs across auth, onboarding, messaging, email, docs, dark theme, mobile, notifications | `b30693c` |
| 2026-04-09 | Notification persistence, tooltips | `8990ecd` |
| 2026-04-09 | Dark theme palette, unread-count decrement | `df310a8` |
| 2026-04-09 | Volunteer → admin + dept-coord profile lookup RLS | `d4e1f19` |
| 2026-04-09 | Mobile viewport hardening across every page | `163e38c` |
| 2026-04-08 | P1/P2/P3 hardening pass + MFA backup codes + e2e REST tests | `62cdb63` |

---

## 16. Contact

For questions about this spec or the codebase:

- **Primary maintainer:** sabihusman (GitHub)
- **Supabase project:** `esycmohgumryeqteiwla` (region us-west-2)
- **Repository issues:** https://github.com/sabihusman/easterseals-volunteer-scheduler/issues

---

*End of technical specification.*
