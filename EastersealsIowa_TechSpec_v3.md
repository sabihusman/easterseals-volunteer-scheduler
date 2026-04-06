# Easterseals Iowa Volunteer Scheduler — Technical Specification v3

**Document Version:** 3.0
**Date:** April 6, 2026
**Repository:** github.com/sabihusman/easterseals-volunteer-scheduler
**Live URL:** easterseals-volunteer-scheduler.vercel.app
**WordPress Landing:** easterseals-volunteer.local (LocalWP)

---

## 1. System Architecture

### 1.1 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend Framework | React | 18.3.1 |
| Language | TypeScript | 5.8.3 |
| Build Tool | Vite | 5.4.19 |
| CSS Framework | Tailwind CSS | 3.4.17 |
| UI Components | shadcn/ui (Radix UI) | Latest |
| Routing | React Router | 6.30.1 |
| State Management | TanStack React Query | 5.83.0 |
| Form Handling | React Hook Form + Zod | 7.61.1 / 3.25.76 |
| Charts | Recharts | 2.15.4 |
| Date Utilities | date-fns | 3.6.0 |
| Toast Notifications | Sonner | 1.7.4 |
| Backend / Database | Supabase (PostgreSQL) | 2.100.1 |
| Authentication | Supabase Auth | Built-in |
| File Storage | Supabase Storage | Built-in |
| Real-time | Supabase Realtime (Postgres Changes) | Built-in |
| Email Service | Resend (via Supabase Edge Functions) | Edge Function |
| Hosting | Vercel | Auto-deploy |
| CI/CD | GitHub Actions | Workflow |
| PWA | vite-plugin-pwa + Workbox | 1.2.0 |
| Landing Page | WordPress (LocalWP) | 6.9.4 |

### 1.2 Architecture Pattern

```
Browser (React SPA / PWA)
    |
    |--- Supabase Client (typed, direct queries)
    |       |--- PostgreSQL (26 tables, RLS policies)
    |       |--- Supabase Auth (email/password, Google OAuth)
    |       |--- Supabase Storage (volunteer-documents, shift-attachments)
    |       |--- Supabase Realtime (messages, notifications)
    |       |--- Supabase Edge Functions (send-email, delete-user)
    |
    |--- Vercel (hosting, auto-deploy from GitHub)
    |--- Service Worker (Workbox, offline caching)
```

**No custom API layer.** The frontend queries Supabase directly. Row Level Security (RLS) policies enforce authorization at the database level using `auth.uid()`, `is_admin()`, `is_coordinator_or_admin()`, and `my_role()` helper functions.

### 1.3 Project Structure

```
easterseals-volunteer-scheduler/
  src/
    App.tsx                          # Router + ProtectedRoute wrapper
    main.tsx                         # Entry point
    contexts/
      AuthContext.tsx                 # Session, user, profile, role
    pages/                           # 25 page components
    components/                      # 29 custom + 53 shadcn/ui
      messaging/                     # 6 messaging components
      ui/                            # shadcn/ui primitives
    hooks/                           # 5 custom hooks
    integrations/supabase/
      client.ts                      # Typed Supabase client
      types.ts                       # Auto-generated DB types (~1600 lines)
    lib/
      calendar-utils.ts              # ICS/CSV export, date formatting
      email-utils.ts                 # Edge function email wrapper
      slot-utils.ts                  # Time slot formatting
      utils.ts                       # cn() tailwind merge
  public/
    icon-192.png, icon-512.png       # PWA icons
    apple-touch-icon.png             # iOS icon
    favicon.ico                      # Browser favicon
  supabase/migrations/               # 11 SQL migration files
  index.html                         # SPA entry with PWA meta tags
  vite.config.ts                     # Vite + PWA plugin config
```

---

## 2. Database Schema

### 2.1 Tables (26 total)

#### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User accounts | full_name, email, phone, role, bg_check_status, total_hours, consistency_score, onboarding_complete, emergency_contact_name/phone |
| `departments` | Volunteer departments | name, description, location_id, requires_bg_check, allows_groups, min_age |
| `locations` | Physical locations | name, address, city, state, timezone |
| `shifts` | Shift definitions | title, shift_date, start_time, end_time, department_id, total_slots, booked_slots, status, requires_bg_check, is_recurring |
| `shift_bookings` | Volunteer shift signups | shift_id, volunteer_id, booking_status, confirmation_status, final_hours, hours_source |
| `shift_time_slots` | 2-hour slot breakdown | shift_id, slot_start, slot_end, total_slots, booked_slots |
| `shift_booking_slots` | Booking-to-slot mapping | booking_id, slot_id |

#### Shift Management Tables

| Table | Purpose |
|-------|---------|
| `shift_recurrence_rules` | Recurring shift patterns (daily/weekly/biweekly/monthly) |
| `shift_notes` | Coordinator notes on bookings |
| `shift_attachments` | Files attached to shift notes |
| `shift_invitations` | Invite-a-friend tokens |
| `volunteer_shift_reports` | Self-confirmation: hours, rating, feedback |
| `confirmation_reminders` | Reminder tracking for coordinators/admins |

#### Recommendation Engine Tables

| Table | Purpose |
|-------|---------|
| `volunteer_shift_interactions` | Tracks viewed/signed_up/cancelled/completed/no_show |
| `volunteer_preferences` | Affinity scores: department, day_of_week, time_of_day |
| `shift_fill_rates` (view) | Calculated fill ratios per shift |

#### Messaging Tables

| Table | Purpose |
|-------|---------|
| `conversations` | Thread metadata (direct/bulk, department_id) |
| `conversation_participants` | User-conversation membership, last_read_at |
| `messages` | Message content with real-time subscription |

#### Document Management Tables

| Table | Purpose |
|-------|---------|
| `document_types` | Admin-defined doc types (name, required, expiry_days) |
| `volunteer_documents` | Uploaded files (status: pending_review/approved/rejected/expired) |

#### Other Tables

| Table | Purpose |
|-------|---------|
| `notifications` | In-app notifications (bell icon) |
| `events` | Community events |
| `event_registrations` | Volunteer event RSVPs |
| `department_coordinators` | Coordinator-to-department mapping |
| `department_restrictions` | Blocked volunteer-department pairs |
| `volunteer_private_notes` | Volunteer's personal notes |

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
| `score_shifts_for_volunteer(uuid, int)` | Recommendation scoring: preference_match(0.5) + org_need(0.3) + novelty(0.2) |
| `is_admin()` | RLS helper: checks current user is admin |
| `is_coordinator_or_admin()` | RLS helper: checks coordinator or admin |
| `my_role()` | Returns current user's role |
| `recalculate_consistency(uuid)` | Updates reliability score |
| `update_volunteer_preferences(uuid)` | Syncs affinity scores from interactions |
| `resolve_hours_discrepancy(uuid)` | Resolves volunteer vs coordinator hours |
| `transfer_admin_role(uuid, uuid)` | Transfers admin privileges |
| `export_critical_data()` | Full data export for backup |

### 2.4 Triggers

| Trigger | Event | Action |
|---------|-------|--------|
| `trg_interaction_update_preferences` | INSERT on volunteer_shift_interactions | Calls `update_volunteer_preferences()` |

### 2.5 Storage Buckets

| Bucket | Access | Path Convention |
|--------|--------|-----------------|
| `shift-attachments` | Coordinator/admin upload, authenticated read | `{userId}/{filename}` |
| `volunteer-documents` | Volunteer upload own, coordinator/admin read all | `{userId}/{docTypeId}/{filename}` |

---

## 3. Authentication & Authorization

### 3.1 Auth Flow

- **Provider:** Supabase Auth (email/password + Google OAuth)
- **Session:** JWT stored in localStorage, auto-refresh enabled
- **Profile hydration:** On auth state change, fetches `profiles` row by `user.id`
- **Role cascade:** volunteer < coordinator < admin (coordinators inherit volunteer views, admins inherit all)

### 3.2 Role-Based Access

| Route Pattern | Required Role |
|---------------|--------------|
| `/dashboard`, `/shifts`, `/history`, `/notes`, `/documents` | volunteer |
| `/coordinator`, `/coordinator/manage` | coordinator or admin |
| `/admin/*` (dashboard, users, departments, events, reminders, settings, documents, compliance) | admin |
| `/messages`, `/settings`, `/events` | any authenticated |
| `/auth`, `/forgot-password`, `/reset-password` | unauthenticated |

### 3.3 Row Level Security

All 26 tables have RLS enabled. Key patterns:
- **Own-data:** `volunteer_id = auth.uid()` or `user_id = auth.uid()`
- **Role-check:** `public.is_admin()` or `public.is_coordinator_or_admin()`
- **Participant-check:** EXISTS subquery on `conversation_participants`

---

## 4. Feature Inventory

### 4.1 Volunteer Features

| Feature | Page/Component | Description |
|---------|---------------|-------------|
| Dashboard | VolunteerDashboard.tsx | Upcoming shifts, total hours, pending confirmations, milestones |
| Browse Shifts | BrowseShifts.tsx | Search/filter shifts by department, date, time; book shifts |
| Smart Recommendations | RecommendedShifts.tsx | Top 8 personalized shifts (scoring function), booking window enforcement |
| Shift History | ShiftHistory.tsx | Past shifts, hours breakdown, CSV export, milestone badges |
| Hours Confirmation Letter | VolunteerHoursLetter.tsx | PDF letter with Easterseals letterhead, shift table, admin signature |
| Shift Confirmation | ShiftConfirmation.tsx | Self-report hours, rate shift, provide feedback |
| Private Notes | MyNotes.tsx | Personal notes linked to shifts/departments, auto-lock after 7 days |
| Document Upload | VolunteerDocuments.tsx | Upload required documents, view status, re-upload on rejection |
| Messaging | Messages.tsx | Send/receive messages to coordinators, real-time thread updates |
| Events | VolunteerEvents.tsx | View and register for community events |
| Onboarding | OnboardingModal.tsx | 5-step first-login flow (profile, departments, browse shifts) |
| Settings | Settings.tsx | Profile, emergency contacts, password, notification preferences |
| Session Timeout | SessionTimeout.tsx | Auto-logout after inactivity |

### 4.2 Coordinator Features

| Feature | Page/Component | Description |
|---------|---------------|-------------|
| Department Dashboard | CoordinatorDashboard.tsx | Shift overview for assigned departments |
| Manage Shifts | ManageShifts.tsx | Create, edit, cancel shifts; recurring shifts |
| Hours Confirmation | CoordinatorHoursConfirmation.tsx | Record/override volunteer hours |
| Messaging | Messages.tsx | Message volunteers, bulk message by department |
| Volunteer Activity | VolunteerActivityTab.tsx | View volunteer bookings, hours, ratings |

### 4.3 Admin Features

| Feature | Page/Component | Description |
|---------|---------------|-------------|
| Admin Dashboard | AdminDashboard.tsx | All shifts overview, total bookings, volunteer count |
| User Management | AdminUsers.tsx | View/edit users, reliability badges, role management |
| Department Management | AdminDepartments.tsx | Create/edit departments, assign coordinators |
| Event Management | AdminEvents.tsx | Create/edit community events |
| Reminders | AdminReminders.tsx | Configure shift confirmation reminders |
| Document Types | AdminDocumentTypes.tsx | Define required document types with expiry |
| Compliance Dashboard | DocumentCompliance.tsx | Volunteer compliance status matrix, approve/reject documents |
| Admin Settings | AdminSettings.tsx | System-wide configuration |
| Bulk Messaging | BulkComposeMessage.tsx | Message all volunteers, filter by department/BG status |

### 4.4 Cross-Cutting Features

| Feature | Implementation |
|---------|---------------|
| Real-time Notifications | NotificationBell.tsx + Supabase Postgres Changes on `notifications` |
| Real-time Messaging | Supabase Realtime on `messages` table |
| Interaction Tracking | useInteractionTracking.ts (fire-and-forget) |
| Reliability Scoring | VolunteerReliabilityBadge.tsx (New/Reliable/Watch/Concern tiers) |
| Background Check Enforcement | Enforced in recommendations and shift booking |
| Booking Window | 14-day (standard) / 21-day (BG check) advance booking limit |
| PWA / Offline | Service worker with Workbox, precached assets, API caching |

---

## 5. Messaging System

### 5.1 Architecture

- **Model:** One conversation per pair of users (direct) or per bulk recipient
- **Real-time:** Supabase Realtime subscription on `messages` table filtered by `conversation_id`
- **Notifications:** New messages insert into `notifications` table, triggering NotificationBell
- **Unread tracking:** `conversation_participants.last_read_at` compared against latest message timestamp
- **Bulk messaging:** Creates individual conversation per recipient (not group chat); tagged with `conversation_type = 'bulk'`

### 5.2 Components

```
Messages.tsx (split-panel layout)
  ConversationList.tsx (left: search, conversations with unread dots)
  ConversationThread.tsx (right: message bubbles, real-time, compose)
  ComposeMessage.tsx (dialog: user search, deduplication, send)
  BulkComposeMessage.tsx (dialog: dept/BG filters, recipient preview)
  MessageBubble.tsx (sender-aligned bubble with timestamp)
```

---

## 6. Document Management System

### 6.1 Workflow

1. **Admin** creates document types (e.g., "Background Check Certificate") with required/optional flag and optional expiry duration
2. **Volunteer** sees required documents on `/documents` page, uploads files (PDF, JPG, PNG, DOC — max 10MB)
3. Files stored in Supabase Storage bucket `volunteer-documents` at `{userId}/{docTypeId}/{timestamp}.{ext}`
4. **Admin/Coordinator** reviews on `/admin/compliance` — approve or reject with optional note
5. Expiry auto-calculated from `document_types.expiry_days` at upload time

### 6.2 Status Flow

```
[missing] → Upload → [pending_review] → Approve → [approved]
                                       → Reject  → [rejected] → Re-upload → [pending_review]
[approved] → Time passes → [expired] → Re-upload → [pending_review]
```

---

## 7. Recommendation Engine

### 7.1 Scoring Formula

```
score = preference_match × 0.5 + org_need × 0.3 + novelty × 0.2
```

| Factor | Weight | Source |
|--------|--------|--------|
| Preference Match | 50% | `volunteer_preferences` affinity scores (department, day, time) |
| Organizational Need | 30% | `shift_fill_rates` view (lower fill ratio = higher need) |
| Novelty | 20% | Inverse of interaction count (encourages trying new departments) |

### 7.2 Constraints

- Only shifts within booking window (14 days standard, 21 days BG-required)
- BG check status enforced for restricted departments
- Trigger `trg_interaction_update_preferences` updates affinity scores on every interaction

---

## 8. Progressive Web App (PWA)

### 8.1 Configuration

| Setting | Value |
|---------|-------|
| Register Type | autoUpdate |
| Display Mode | standalone |
| Orientation | portrait-primary |
| Theme Color | #006B3E |
| Background | #ffffff |

### 8.2 Caching Strategy

| Resource | Strategy | TTL |
|----------|----------|-----|
| Static assets (JS, CSS, HTML, fonts) | Precache | Build-versioned |
| Supabase API responses | NetworkFirst | 5 minutes, 50 entries max |
| Google Fonts CSS | CacheFirst | 1 year |
| Google Fonts WOFF2 | CacheFirst | 1 year |

### 8.3 Icons

| Size | Purpose | File |
|------|---------|------|
| 192x192 | Android/Chrome | icon-192.png |
| 512x512 | Android splash / maskable | icon-512.png |
| 180x180 | iOS home screen | apple-touch-icon.png |

---

## 9. WordPress Landing Page

### 9.1 Setup

| Setting | Value |
|---------|-------|
| Platform | WordPress 6.9.4 on LocalWP |
| Server | nginx + PHP 8.2.29 + MySQL 8.0.35 |
| Domain | easterseals-volunteer.local |
| Theme | Custom: `easterseals-landing` |

### 9.2 Theme Structure

```
easterseals-landing/
  style.css              # Theme metadata
  functions.php          # Asset enqueuing, theme support, ES_APP_URL constant
  index.php              # Fallback template
  header.php             # Top bar, navigation, SVG logo
  footer.php             # 4-column footer, smooth scroll JS
  front-page.php         # Landing page template
  assets/css/main.css    # Full responsive styling
```

### 9.3 Landing Page Sections

1. **Top Bar** — burnt orange (#cf4b04) network link
2. **Header** — sticky nav with Easterseals logo + "Volunteer Portal" CTA
3. **Hero** — split layout: orange panel (headline + CTAs) | navy panel (brand text)
4. **Stats Bar** — navy background, 4 gold stats (500+ volunteers, 12 departments, etc.)
5. **How It Works** — 4 step cards on beige background
6. **Departments** — 6 cards with SVG icons in 3x2 grid
7. **Features** — 2x2 grid with green dot accents
8. **CTA** — navy section with sign-up buttons
9. **Footer** — dark footer with quick links, contact, social

### 9.4 Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Navy | #1B2A4A | Hero right panel, stats bar, CTA, footer |
| Burnt Orange | #cf4b04 | Top bar, hero background, nav button, step circles |
| Bright Orange | #ffa300 | Accent icons, stat numbers, brand text, hover states |
| Rust | #b64204 | Deep hover states |
| Green | #006B3E | Easterseals brand, feature dots |
| Cream | #FFF5E6 | Button backgrounds |
| Beige | #F5EDE3 | Section backgrounds |

---

## 10. CI/CD & Deployment

### 10.1 Pipeline

```
Developer pushes to main
    → GitHub Actions CI (lint, type-check, test)
    → Vercel auto-deploy (build + CDN distribution)
    → Service worker auto-updates on next visit
```

### 10.2 Environment Variables

| Variable | Location |
|----------|----------|
| `VITE_SUPABASE_URL` | Vercel env |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel env |

### 10.3 Supabase Project

| Setting | Value |
|---------|-------|
| Project ID | esycmohgumryeqteiwla |
| Region | (Supabase default) |
| Database | PostgreSQL with 26 tables, 1 view |
| Edge Functions | send-email, delete-user |
| Storage | 2 buckets (shift-attachments, volunteer-documents) |

---

## 11. Codebase Metrics

| Metric | Value |
|--------|-------|
| Total source files | 122 (.ts/.tsx) |
| Page components | 25 |
| Custom components | 29 |
| UI library components | 53 (shadcn/ui) |
| Custom hooks | 5 |
| Database tables | 26 |
| Database views | 1 |
| Database functions | 9 |
| SQL migrations | 11 |
| Supabase Edge Functions | 2 |
| Storage buckets | 2 |
| Total git commits | 55+ |

---

## 12. Security

### 12.1 Authentication

- Supabase Auth with JWT tokens
- Password strength enforcement (letter + number + 8 char minimum)
- Google OAuth as alternative
- Session auto-refresh with localStorage persistence
- Inactivity timeout (configurable)

### 12.2 Authorization

- All database access through RLS policies
- Role-based route protection in React Router
- Three-tier role hierarchy: volunteer < coordinator < admin
- Background check status enforced for restricted departments

### 12.3 Data Protection

- File uploads scoped to user's own directory path
- Volunteers can only read/write own data
- Coordinators see only their department's volunteers
- Admin override for all read operations
- No sensitive data in URL parameters

---

## 13. Known Limitations

1. **No SMS notifications** — Twilio integration planned but deferred
2. **No email delivery for messaging** — in-app only; email notifications via existing send-email Edge Function for shift events
3. **Bulk messaging is sequential** — for >50 recipients, consider server-side batch via Edge Function
4. **Document expiry reminders** — not yet automated (requires pg_cron or scheduled Edge Function)
5. **Landing page not deployed** — running on LocalWP only; needs domain purchase and hosting
6. **Chunk size warning** — main JS bundle is ~930KB; consider code-splitting for page-level lazy loading

---

*Generated April 6, 2026 — Easterseals Iowa Volunteer Scheduler v3.0*
