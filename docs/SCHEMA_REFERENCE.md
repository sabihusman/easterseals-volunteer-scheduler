# Schema Reference

Reference for every table, view, trigger, and scheduled job in the production schema. Source of truth: `supabase/migrations/`. Authorization rules are split off into [RLS_REFERENCE.md](./RLS_REFERENCE.md). For the wider context, see [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md).

**Conventions:**
- All tables use `uuid` primary keys (`gen_random_uuid()` or `extensions.uuid_generate_v4()` defaults). PKs aren't repeated below unless they're composite.
- All tables have `created_at timestamptz DEFAULT now()`; only listed when notable.
- "Key columns" are the columns a maintainer is most likely to query or join on, not exhaustive — read the migration for the full DDL.

---

## Identity & Auth

### `profiles`
**Purpose:** The user-facing record for every authenticated user. One row per `auth.users` row, joined on `id`.

**Key columns:**
- `id uuid` (PK, references `auth.users.id`)
- `full_name`, `email`, `phone`, `username` (citext, optional)
- `role user_role` — enum: `volunteer | coordinator | admin`. Drives every RLS policy.
- `is_active bool` — soft-delete flag. RLS denies most actions when false.
- `bg_check_status` — enum: `pending | clear | expired | rejected`
- `bg_check_updated_at`, `bg_check_expires_at`
- `consistency_score numeric(5,2)` — derived from booking outcomes. Updated by triggers, not directly written.
- `extended_booking bool` — earned through consistent attendance; widens the booking-window-days from 14 to 21.
- `total_hours`, `volunteer_points` — derived counters.
- `notif_email`, `notif_sms`, `notif_in_app`, `notif_*` (per-event opt-outs)
- `messaging_blocked bool` — admin-set; suppresses outbound messages.
- `signin_count int` — incremented in [AuthContext.tsx](../src/contexts/AuthContext.tsx) on every `SIGNED_IN` event. Drives the onboarding modal cadence.
- `calendar_token uuid` — opaque token in the `.ics` URL.
- `is_minor bool`, `date_of_birth` — feeds the parental-consent flow.

**Relationships:** Heavily referenced. FKs *into* `profiles` from nearly every table that tracks a user. The migration `20260423000002_profile_fk_cascade_audit.sql` audited 24 FKs and standardized the cascade behavior to `ON DELETE SET NULL` for "preserve history" tables (bookings, reports, audit logs) and `ON DELETE CASCADE` for "user-private" tables.

**Notable:** Created by trigger when a row inserts into `auth.users` (handled via Supabase Auth hook).

### `mfa_backup_codes`
**Purpose:** Hashed MFA recovery codes per user.

**Key columns:** `user_id`, `code_hash`, `used_at`. RLS denies all client reads/writes (`deny all client` policy); only the `mfa-recovery` edge function (service role) touches it.

### `admin_mfa_resets`
**Purpose:** Audit trail of admin-forced MFA resets.

**Key columns:** `reset_by` (admin username/email), `target_user_id`, `target_email`, `reset_method`, `notes`. Append-only; admins can read but not delete.

### `parental_consents`
**Purpose:** Digital parental consent records for minor volunteers.

**Key columns:** `volunteer_id`, `parent_name`, `parent_email`, `parent_phone`, `consent_method` (default `'digital'`), `expires_at`, `is_active`. Created in baseline migration and re-affirmed in `20260410_minor_consent.sql` to add the trigger `trg_sync_is_minor` that auto-flags `profiles.is_minor` from `date_of_birth`.

---

## Departments & Coordinators

### `locations`
**Purpose:** Physical sites where shifts happen.

**Key columns:** `name`, `address`, `city`, `state`, `timezone` (default `America/Chicago`), `is_active`.

### `departments`
**Purpose:** A program at a location (e.g. "Camp Sunnyside Day Camp" at Camp Sunnyside).

**Key columns:** `location_id` (FK), `name`, `description`, `requires_bg_check bool` (default true), `min_age int` (default 18), `allows_groups bool`, `is_active`.

### `department_coordinators`
**Purpose:** Many-to-many: which coordinator manages which department.

**Key columns:** Composite PK `(department_id, coordinator_id)`. `assigned_at`. RLS lets any coordinator SELECT all rows — frontend filters with `coordinator_id=eq.<auth.uid()>`.

### `department_restrictions`
**Purpose:** A volunteer banned from a specific department.

**Key columns:** `department_id`, `volunteer_id`, `restricted_by`, `reason`. UNIQUE `(department_id, volunteer_id)`. Enforced at booking time by trigger `trg_enforce_dept_restriction`.

---

## Shifts

### `shifts`
**Purpose:** A single date+time block in a department where volunteers are needed.

**Key columns:**
- `department_id`, `created_by`
- `title`, `description`
- `shift_date`, `time_type shift_time_type` (enum: `morning | afternoon | full_day | custom`), `start_time`, `end_time`
- `total_slots int`, `booked_slots int` — `chk_slots` constraint enforces `0 <= booked_slots <= total_slots`. `booked_slots` is auto-synced by trigger `trg_sync_slots`.
- `requires_bg_check bool`
- `status shift_status` — enum: `open | full | cancelled | completed`. Auto-transitioned by trigger `trg_shift_status` and the `shift-status-transition` cron.
- `is_recurring`, `recurrence_rule`, `recurrence_parent` — recurrence is generation-based: a parent shift creates child shifts via `shift_recurrence_rules`, not by stretching a single row.
- `allows_group bool`, `max_group_size int`
- `coordinator_note text`, `note_updated_at`

**Constraints:** `chk_slots`, `chk_recurrence_rule` (limits enum values).

### `shift_time_slots`
**Purpose:** Sub-divisions within a shift (e.g. 2-hour slots in an 8-hour shift). Auto-generated by trigger `trg_generate_time_slots` when a shift inserts.

**Key columns:** `shift_id`, `slot_start time`, `slot_end time`, `total_slots`, `booked_slots`. Constraints: `chk_slot_times` (slot_end > slot_start), `chk_slot_slots`.

**RLS:** Server-only writes — restrictive policies deny `INSERT`/`UPDATE`/`DELETE` from clients; reads are open. The trigger maintains it.

### `shift_recurrence_rules`
**Purpose:** Defines a repeating pattern that generates `shifts` rows.

**Key columns:** `department_id`, `created_by`, `recurrence_type recurrence_type`, `start_date`, `end_date`, plus the shift template fields (`title`, `description`, `time_type`, `total_slots`, etc.). Constraint `chk_max_6_months` caps the generated range.

### `shift_invitations`
**Purpose:** Invite a specific person (by email or existing volunteer) to a shift.

**Key columns:** `shift_id`, `invited_by`, `invite_email`, `invite_name`, `volunteer_id` (nullable — set if the invitee is already a registered volunteer), `token uuid` (in the email link), `status` (`pending | accepted | declined | expired`), `expires_at`. Default expiry: 7 days. Cron `expire-shift-invitations` flips stale rows to `expired`.

### `shift_notes`
**Purpose:** Coordinator/volunteer notes attached to a specific booking.

**Key columns:** `booking_id`, `author_id`, `content`, `is_locked` (admin-set; once locked, only admin can edit).

### `shift_attachments`
**Purpose:** File uploads attached to a `shift_note` (e.g. a receipt photo).

**Key columns:** `note_id`, `uploader_id`, `file_name`, `file_type`, `storage_path` (Supabase Storage path), `file_size`.

---

## Bookings

### `shift_bookings`
**Purpose:** A volunteer's signup for a shift. The most-trafficked table in the app.

**Key columns:**
- `shift_id`, `volunteer_id` (`SET NULL` on profile cascade — preserves history)
- `booking_status booking_status` — enum: `confirmed | waitlisted | cancelled | no_show`
- `confirmation_status confirmation_status` — enum: `pending_confirmation | attended | no_show | disputed`. Drives consistency-score recalculation.
- `confirmed_by`, `confirmed_at` — coordinator who marked attendance
- `is_group_booking`, `group_name`, `group_size`
- `counted_in_consistency bool` — sticky flag set after confirmation; freezes the historical record from being re-counted if a status changes much later.
- `checked_in_at`, `cancelled_at`, `late_cancel_notified bool`
- `volunteer_reported_hours`, `coordinator_reported_hours`, `final_hours numeric(5,2)`, `hours_source text`
- `promoted_at`, `waitlist_offer_expires_at` — set when this booking gets promoted from waitlist; expiry is 2 hours.
- `time_slot_id` (FK to `shift_time_slots`)
- `coordinator_status text` — `attended | absent`, the coordinator's claim. May disagree with the volunteer's self-report → triggers a dispute row.
- `coordinator_actioned_at`, `coordinator_actioned_by`, `checked_in bool`

**Triggers:** Many. See § Triggers and jobs below.

### `shift_booking_slots`
**Purpose:** Junction table — a single booking can occupy multiple time slots within a shift.

**Key columns:** `booking_id`, `slot_id`. Trigger `trg_sync_slot_count` keeps `shift_time_slots.booked_slots` in step.

### `volunteer_shift_reports`
**Purpose:** The volunteer's self-report after a shift ends — attended? hours? rating? feedback?

**Key columns:**
- `booking_id` (UNIQUE — one report per booking), `volunteer_id`
- `self_confirm_status self_confirm_status` — enum: `pending | attended | no_show`
- `self_reported_hours numeric(5,2)`, `star_rating int 1-5`, `shift_feedback text`
- `submitted_at`, `reminder_sent_at`

**View:** `volunteer_shift_reports_safe` is a `security_barrier` view that strips `shift_feedback` and `star_rating` for downstream use that doesn't need the freeform text.

---

## Attendance

### `checkin_tokens`
**Purpose:** QR-code tokens used at the volunteer table for self check-in.

**Key columns:** `token text UNIQUE`, `is_active bool`, `rotation_mode` (`none | daily | weekly | monthly`), `expires_at`. Cron `rotate-checkin-tokens` rotates non-`none` tokens hourly.

### `attendance_disputes`
**Purpose:** When a volunteer's self-report and the coordinator's marking disagree.

**Key columns:**
- `booking_id UNIQUE`, `shift_id`, `volunteer_id`, `coordinator_id`
- `volunteer_status`, `volunteer_reported_hours`, `coordinator_status`
- `admin_decision text` — check constraint limits to `volunteer_upheld | coordinator_upheld`
- `admin_decided_by`, `admin_decided_at`, `admin_notes`
- `resolved_by text` — `admin | auto_timeout`
- `final_hours_awarded`
- `expires_at` — defaults to `now() + 7 days`. Cron `dispute-auto-resolve` resolves expired disputes in the volunteer's favor.

### `confirmation_reminders`
**Purpose:** Audit log of confirmation reminder emails sent (to volunteer or coordinator).

**Key columns:** `booking_id`, `recipient_type reminder_recipient` (enum: `volunteer | coordinator`), `recipient_id`, `sent_at`, `reminder_number int`. The cron jobs `unactioned-shift-volunteer-reminder` / `unactioned-shift-coordinator-reminder` write rows here.

---

## Communication

### `conversations`
**Purpose:** A messaging thread (1:1 direct or 1:N bulk).

**Key columns:** `subject text` (optional), `conversation_type` (`direct | bulk`), `department_id` (optional, for bulk department announcements), `created_by`, `updated_at`. The `updated_at` is bumped on every new message — drives the "recent conversations" sort.

### `conversation_participants`
**Purpose:** Who's in a conversation.

**Key columns:** UNIQUE `(conversation_id, user_id)`. `last_read_at`, `is_archived`, `cleared_at` (per-user soft-delete cutoff for messages). Read state and "delete this thread on my side only" both live here.

### `messages`
**Purpose:** Individual messages.

**Key columns:** `conversation_id`, `sender_id`, `content`. Append-only; no edit/delete primitives in the app. Realtime subscriptions are on this table filtered by `conversation_id`.

### `notifications`
**Purpose:** In-app notification inbox + driver for email/SMS via the `notification-webhook` edge function.

**Key columns:** `user_id`, `type text`, `title`, `message`, `is_read`, `link text`, `data jsonb`. The `notify_email_on_notification` trigger fires the webhook on insert. Cron `prune-read-notifications` deletes read+ >90d rows.

---

## Volunteer Attributes

### `volunteer_documents`
**Purpose:** Uploaded documents (background check certificate, training cert, etc.) per volunteer.

**Key columns:** `volunteer_id`, `document_type_id`, `file_name`, `storage_path`, `status` (`pending_review | approved | rejected | expired`), `reviewed_by`, `reviewed_at`, `review_note`, `expires_at`.

### `document_types`
**Purpose:** Admin-managed catalog of what documents are required.

**Key columns:** `name`, `is_required`, `has_expiry`, `expiry_days int`, `is_active`.

### `volunteer_preferences`
**Purpose:** Derived preference signals used by the recommendation engine.

**Key columns:** `volunteer_id` (PK), `day_of_week_affinity jsonb`, `time_of_day_affinity jsonb`, `department_affinity jsonb`, `avg_advance_booking_days double precision`, `total_interactions int`, `reliability_alpha`/`reliability_beta` (Beta distribution params for "will they show up?" estimate). Trigger `trg_interaction_update_preferences` updates this on every `volunteer_shift_interactions` insert.

### `volunteer_private_notes`
**Purpose:** A volunteer's private notes about their own shifts (visible only to them).

**Key columns:** `volunteer_id`, `shift_id` (optional), `department_id` (optional), `title`, `content`, `is_locked`. RLS: only the owner can read/write. Admin "break-glass" reads are audited via `private_note_access_log`.

### `volunteer_shift_interactions`
**Purpose:** Event log of how volunteers interact with shifts (viewed, booked, cancelled).

**Key columns:** `volunteer_id`, `shift_id`, `interaction_type interaction_type` (enum). Drives `volunteer_preferences` derivation.

---

## Auditing

### `admin_action_log`
**Purpose:** Audit trail of admin actions taken on a volunteer's behalf.

**Key columns:** `admin_id`, `volunteer_id`, `action text`, `payload jsonb`. Read-only for admins; service role writes.

### `private_note_access_log`
**Purpose:** Break-glass log when an admin reads a volunteer's private notes.

**Key columns:** `admin_user_id`, `volunteer_id`, `note_id`, `access_reason text` (CHECK: at least 20 chars), `accessed_at`. RLS denies UPDATE and DELETE — append-only.

---

## Events

### `events`
**Purpose:** Standalone events (fundraisers, walks). Distinct from recurring shifts.

**Key columns:** `created_by`, `title`, `description`, `event_date`, `start_time`, `end_time`, `location text`, `max_attendees`, `requires_bg_check`.

### `event_registrations`
**Purpose:** Volunteer signups for events.

**Key columns:** `event_id`, `volunteer_id`. UNIQUE `(event_id, volunteer_id)`.

---

## Views

- **`shift_fill_rates`** — `shift_id`, `total_slots`, `booked_slots`, `department_id`, `shift_date`, `time_type`, `day_of_week`, `fill_ratio`. Filters out cancelled shifts and past dates. Used by the coordinator coverage dashboard and the recommendation engine.
- **`volunteer_shift_reports_safe`** — `security_barrier` view exposing `volunteer_shift_reports` without the freeform `shift_feedback` and `star_rating` columns. Used where downstream code only needs structured fields.

---

## Triggers and jobs

### Triggers (selected highlights — full list in the migration)

The baseline migration registers ~40 triggers. The most consequential:

| Trigger | Table | When | What it does |
|---|---|---|---|
| `trg_admin_cap` | `profiles` | BEFORE INSERT/UPDATE OF role | Caps the number of `admin` rows (anti-foot-gun). |
| `trg_booking_window` | `shift_bookings` | BEFORE INSERT | Rejects bookings >14 days out (or 21 if `extended_booking=true`). |
| `trg_cancel_bookings_on_delete` | `profiles` | BEFORE DELETE | Cancels open bookings before the FK cascade — avoids notifying about deleted users. |
| `trg_cascade_bg_check_expiry` | `profiles` | AFTER UPDATE OF bg_check_status | Cascades expiry to dependent bookings. |
| `trg_check_attendance_dispute` | `shift_bookings` | BEFORE UPDATE OF coordinator_status | Creates an `attendance_disputes` row when volunteer + coordinator disagree. |
| `trg_email_on_notification` | `notifications` | AFTER INSERT | Fires the `notification-webhook` edge function. |
| `trg_enforce_dept_restriction` | `shift_bookings` | BEFORE INSERT | Blocks booking if a `department_restrictions` row exists for this volunteer. |
| `trg_enforce_shift_not_ended_*` | `shift_bookings` | BEFORE INSERT/UPDATE | Rejects bookings on shifts whose `shift_date + end_time` is in the past. |
| `trg_generate_time_slots` | `shifts` | AFTER INSERT | Auto-creates `shift_time_slots` rows. |
| `trg_prevent_overlapping_bookings` | `shift_bookings` | BEFORE INSERT/UPDATE | Rejects a confirmed booking if the volunteer has another confirmed/promoted booking in the same time window. |
| `trg_prevent_role_self_escalation` | `profiles` | BEFORE UPDATE OF role | Prevents users from updating their own role (admins can update others'). |
| `trg_recalc_consistency` (×2) | `shift_bookings` | AFTER UPDATE OF confirmation_status / DELETE | Re-derives `profiles.consistency_score` and `extended_booking` privileges. |
| `trg_recalculate_points_*` (×3) | `shift_bookings` | UPDATE/DELETE | Re-derives `profiles.volunteer_points`. |
| `trg_shift_status` | `shifts` | BEFORE UPDATE OF booked_slots | Auto-flips `open ↔ full` based on remaining slots. |
| `trg_sync_is_minor` | `profiles` | BEFORE INSERT/UPDATE OF date_of_birth | Sets `is_minor` from `date_of_birth`. |
| `trg_sync_slots*` (×3) | `shift_bookings` / `shift_booking_slots` | AFTER INSERT/UPDATE/DELETE | Keeps `shifts.booked_slots` and `shift_time_slots.booked_slots` in sync. |
| `trg_sync_volunteer_hours` | `volunteer_shift_reports` | AFTER INSERT/UPDATE OF self_reported_hours | Mirrors the volunteer's reported hours into `shift_bookings.volunteer_reported_hours` and runs `resolve_hours_discrepancy()`. |
| `trg_validate_booking_slots*` (×2) | `shift_bookings` | BEFORE INSERT/UPDATE | When `booking_status='confirmed'`, asserts the linked slots respect `total_slots` capacity. |
| `trg_volunteer_only_booking` | `shift_bookings` | BEFORE INSERT | Demotes a coordinator/admin's `confirmed` booking to `waitlisted` (volunteers-only book confirmed). |
| `trg_waitlist_promote*` (×2) | `shift_bookings` | AFTER UPDATE/DELETE | When a confirmed booking cancels/deletes, promotes the next waitlisted booking and sets `waitlist_offer_expires_at = now() + 2 hours`. |
| Migration-added triggers | `shifts` / `shift_bookings` | various | `trg_enforce_completed_shift_immutability`, `trg_block_bookings_on_completed_shifts`, `trg_prevent_delete_bookings_on_completed_shifts` (`20260415000000_shift_lifecycle_rules.sql`). |

### pg_cron jobs (15 total)

Documented in [OPERATIONS_RUNBOOK.md § Cron jobs](./OPERATIONS_RUNBOOK.md#cron-jobs) with the inspection query. Reproduced here for cross-reference:

| Job | Schedule | Source |
|---|---|---|
| `dispute-auto-resolve` | `17 * * * *` | dashboard |
| `expire-documents-daily` | `0 7 * * *` | dashboard |
| `expire-shift-invitations` | `*/15 * * * *` | dashboard |
| `prune-read-notifications` | `0 8 * * *` | dashboard |
| `reconcile-shift-counters` | `0 9 * * *` | dashboard |
| `rotate-checkin-tokens` | `0 * * * *` | dashboard |
| `self-confirmation-reminder` | `*/30 * * * *` | dashboard |
| `shift-reminder-24h` | `0 * * * *` | dashboard |
| `shift-reminder-2h` | `30 * * * *` | dashboard |
| `shift-status-transition` | `*/15 * * * *` | **migration** ([20260415000000_shift_lifecycle_rules.sql](../supabase/migrations/20260415000000_shift_lifecycle_rules.sql)) |
| `unactioned-shift-auto-delete` | `0 8 * * *` | dashboard |
| `unactioned-shift-coordinator-reminder` | `0 15 * * *` | dashboard |
| `unactioned-shift-volunteer-reminder` | `0 15-22 * * *` | dashboard |
| `waitlist-offer-expire` | `*/5 * * * *` | dashboard |
| `warn-expiring-documents-daily` | `0 13 * * *` | dashboard |

The 14 dashboard-managed jobs are flagged as a follow-up in [issue #116](https://github.com/sabihusman/easterseals-volunteer-scheduler/issues/116) — they need to be exported to a migration so a fresh project can recreate them. See [DECISION_LOG.md § Cron-jobs-in-dashboard](./DECISION_LOG.md#cron-jobs-currently-live-only-in-the-supabase-dashboard).
