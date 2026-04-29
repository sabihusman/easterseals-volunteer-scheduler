# RLS Reference

Row Level Security policies, table by table. Source of truth: `supabase/migrations/`. For the schema (columns, FKs, triggers), see [SCHEMA_REFERENCE.md](./SCHEMA_REFERENCE.md).

**Effective policies live across five migrations** (118 in baseline, plus deltas in `20260414000001`, `20260414000003`, `20260414130000`, `20260410_minor_consent`). The list below reflects the *current* effective state — where a later migration replaces an earlier policy of the same name, the later definition wins.

## Helper functions

Three SQL helpers do most of the role-resolution work. Defined in the baseline migration as `SECURITY DEFINER` functions on `auth` so RLS can call them without recursion.

- **`is_admin()`** — `SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'`. Returns `bool`. Used by every "admin-only" policy.
- **`is_coordinator_or_admin()`** — true if `role IN ('coordinator', 'admin')`. The "staff" check.
- **`is_coordinator_for_my_dept(target_user_id uuid)`** — true if the caller is a coordinator and `target_user_id` is a coordinator-or-volunteer in one of the caller's departments. Used by visibility policies on `profiles`.
- **`has_active_booking_on(shift_id uuid)`** — true if the caller has a non-cancelled booking on the given shift. Lets volunteers see their own shifts even after the public-listing window has elapsed.

These helpers stand in for the inline `EXISTS (SELECT … FROM department_coordinators …)` subqueries that the early baseline used; the `20260414130000_harden_rls_policies.sql` migration consolidated them after the security advisor flagged duplicated EXISTS chains as a footgun.

---

## Identity & Auth

### `profiles`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `profiles: own read` | SELECT | The user themselves | Self-service: every authenticated user reads their own row. |
| `profiles: own update` | UPDATE | The user themselves | Self-service profile edits (email, phone, notification prefs). Role escalation blocked by trigger `trg_prevent_role_self_escalation`. |
| `profiles: insert self` | INSERT | The user themselves (auth.uid() = id) | Bootstraps the profile row created post-signup. |
| `profiles: admin read` | SELECT | Admin | Admin user-management views read every profile. |
| `profiles: admin update` (×2) | UPDATE | Admin | Admin can change another user's role, deactivate, etc. |
| `profiles: admin delete` | DELETE | Admin | Hard-delete. Cascades to dependent tables (FK audit migration). |
| `profiles: coordinator read dept volunteers` | SELECT | Coordinator (their dept's volunteers) | Coordinator dashboards show their volunteers' names + emergency contacts. |
| `profiles: volunteer read admins and dept coordinators` | SELECT | Volunteer | Volunteers see admin contact info; for coordinators, only those in *their* department (via `is_coordinator_for_my_dept(id)`). |

### `mfa_backup_codes`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `mfa_backup_codes: deny all client` | ALL | (none — `USING (false)`) | Backup codes are hashed and only readable by the `mfa-recovery` edge function (service role). No client should ever see this table. |

### `admin_mfa_resets`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `admin_mfa_resets: admin read` | SELECT | Admin | Audit-trail visibility. Inserts come from the `admin-reset-mfa` edge function (service role). |

### `parental_consents`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `consent: volunteer own read` | SELECT | The volunteer | A minor sees their own consent records. |
| `consent: volunteer own insert` | INSERT | The volunteer | Volunteers (or their parent on their behalf, in-app) record consent. |
| `consent: coordinator read` | SELECT | Coordinator | Limited to volunteers in the coordinator's departments. |
| `consent: admin all` | ALL | Admin | Admin manages consent records. |

---

## Departments & Coordinators

### `locations`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `locations: all read` | SELECT | Anyone | Reference data; fine for any authenticated user. |
| `locations: admin write` | INSERT/UPDATE/DELETE | Admin | Locations are admin-managed. |

### `departments`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `departments: all read` | SELECT | Anyone (including unauthenticated) | Volunteers browse the public department list before signing up. |
| `departments: admin write` | INSERT/UPDATE/DELETE | Admin | Departments are admin-managed. |

### `department_coordinators`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `dept_coords: admin manage` | ALL | Admin | Admin assigns/removes coordinators. |
| `dept_coords: coord read` | SELECT | Coordinator/Admin | Any coordinator can see *all* assignments. **Frontend caveat:** filter with `coordinator_id=eq.<auth.uid()>` to scope to the caller; otherwise you'll show other coordinators' departments. |

### `department_restrictions`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `restrictions: admin all` | ALL | Admin | Admin oversight. |
| `restrictions: coordinator manage` | ALL | Coordinator (own dept) | A coordinator can ban a volunteer from their own department. |
| `restrictions: coordinator delete` | DELETE | Coordinator (own dept) or Admin | Lifting a restriction is the same scope as creating one. |
| `restrictions: volunteer own read` | SELECT | The restricted volunteer | A banned volunteer can see they're banned (and ideally why). |

---

## Shifts

### `shifts`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `shifts: all read open` | SELECT | Authenticated | Volunteers see future, non-cancelled shifts. Past shifts (or cancelled) are visible to staff only. |
| `shifts: read booked` | SELECT | Volunteers with an active booking on the shift | Lets a volunteer view a past/full shift they're booked on (cross-cuts the "all read open" policy with `has_active_booking_on(id)`). |
| `shifts: coord/admin insert` | INSERT | Coordinator (own dept) or Admin | Only staff create shifts. |
| `shifts: coord/admin update` | UPDATE | Coordinator (own dept) or Admin | Edit guarded; coordinators can only update shifts in their own departments. |
| `shifts: coord delete cancelled` | DELETE | Coordinator (own dept, status=cancelled) | Coordinators can hard-delete *only* shifts they've already cancelled — soft cleanup. |
| `shifts: admin delete` | DELETE | Admin | Admin can delete any shift. |

### `shift_time_slots`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `time_slots: all read` | SELECT | Anyone (auth not required) | Slots show up in public shift listings. |
| `shift_time_slots: deny client *` (3 RESTRICTIVE) | INSERT/UPDATE/DELETE | (no client) | Slots are server-managed only; the trigger `trg_generate_time_slots` writes them. |
| `time_slots: coord/admin write` | INSERT/UPDATE/DELETE | Coordinator/Admin (intended for service role only) | Override for direct admin editing if needed. |

### `shift_recurrence_rules`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `recurrence: all read` | SELECT | Anyone | Public template list. |
| `recurrence: coord/admin manage` | ALL | Coordinator/Admin | Staff manage recurrence patterns. |

### `shift_invitations`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Volunteers can read own invitations` | SELECT | Volunteer (theirs) or inviter | Both sides of the invite see it. |
| `Volunteers can update own invitation status` | UPDATE | Volunteer (theirs) | Accept/decline own invitations. |
| `Authenticated users can insert invitations` | INSERT | Any authenticated user | Volunteers can invite friends; the inviter check happens client-side at write time. |
| `invitations: own read` | SELECT | Inviter | Invitee may not yet have an `auth.uid()` (email-based invite). |
| `invitations: coord/admin read` | SELECT | Coordinator/Admin | Staff oversight. |
| `invitations: volunteer insert` | INSERT | Volunteer (with shift-eligibility check) | Stricter pre-trigger check on top of the broad authenticated-insert policy. |
| `Admins can manage all invitations` | ALL | Admin | Force-cleanup. |

### `shift_notes`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `notes: volunteer own` | SELECT | Volunteer (their own bookings) | A volunteer reads notes on their own bookings. |
| `notes: volunteer insert` | INSERT | Volunteer (as `author_id`) | Volunteers can leave notes. |
| `notes: volunteer update` | UPDATE | Volunteer (own + not locked) | Volunteers edit until an admin locks. |
| `notes: coord/admin read` | SELECT | Coordinator/Admin | Staff visibility. |
| `notes: admin lock` | UPDATE | Admin | Admin sets `is_locked` to freeze. |

### `shift_attachments`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `attachments: volunteer own` | SELECT | Uploader | Volunteer reads files they uploaded. |
| `attachments: volunteer insert` | INSERT | Uploader (as self) | Volunteer attaches files to their notes. |
| `attachments: volunteer own delete` | DELETE | Uploader | Volunteer can remove their own attachments. |
| `attachments: coord/admin read` | SELECT | Coordinator/Admin | Staff sees attached files for review. |
| `attachments: coord/admin delete` | DELETE | Coordinator/Admin | Staff can remove inappropriate uploads. |

---

## Bookings

### `shift_bookings`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `bookings: volunteer own` | SELECT | Volunteer (theirs) | "My bookings" view. |
| `bookings: volunteer insert` | INSERT | Volunteer (as self) | Volunteer books a shift. Triggers do the heavy validation (overlap, window, restriction, role demotion). |
| `bookings: coordinator dept` | SELECT | Coordinator/Admin (and dept-scoped for plain coords) | Coordinator sees bookings in their department. |
| `bookings: coord confirm` | UPDATE | Coordinator/Admin | Coordinator marks attendance. |

### `shift_booking_slots`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `booking_slots: volunteer own` | SELECT | Volunteer (their bookings) | Visibility for own slot selection. |
| `booking_slots: volunteer insert` | INSERT | Volunteer (their bookings) | Volunteer attaches slots when booking. |
| `booking_slots: volunteer delete own` | DELETE | Volunteer (their bookings) | Volunteer can release a slot. |
| `booking_slots: coord/admin read` | SELECT | Coordinator/Admin | Staff oversight. |

### `volunteer_shift_reports`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `reports: volunteer own` | ALL | Volunteer (theirs) | Self-confirm flow writes here. |
| `reports: coord/admin insert` | INSERT | Coordinator/Admin | Coordinator can pre-populate a report on the volunteer's behalf. |

---

## Attendance

### `checkin_tokens`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Admins can manage checkin_tokens` | ALL | Admin | Tokens are sensitive; admin-only management. Reads happen via the QR flow (server-side check). |

### `attendance_disputes`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `attendance_disputes: admin full access` | ALL | Admin | Admin resolves disputes. |
| `attendance_disputes: coordinator read own` | SELECT | Coordinator (those they raised) | Coordinator sees their own disputed bookings. |
| `attendance_disputes: volunteer read resolved` | SELECT | Volunteer (theirs, after `admin_decision IS NOT NULL` or `expires_at` passed) | Volunteer can see a dispute *only after* it's resolved (avoids gaming the system mid-dispute). |

### `confirmation_reminders`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `reminders: admin read` | SELECT | Admin | Audit visibility. |
| `reminders: coord read` | SELECT | The recipient (coordinator) | Coord sees reminders sent to them. |

---

## Communication

### `conversations`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Authenticated users create conversations` | INSERT | Authenticated (subject to staff-side checks for bulk) | Anyone can start a 1:1; bulk requires staff. |
| `Participants read conversations` | SELECT | Creator or participants | Read access scoped to participation. |
| `Participants update conversations` | UPDATE | Participants | Subject edits or `updated_at` bumps. |

### `conversation_participants`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Users read own participations` | SELECT | Self or admin | A user only sees rows where they are a participant. To resolve the OTHER participant in conversations, the frontend uses three paths: (1) `messages.sender_id`, (2) `conversations.created_by`, (3) the SECURITY DEFINER RPC `get_other_participants(uuid[])` for self-created conversations pending the first reply. The RPC re-checks caller-membership inside the body so the SECURITY DEFINER context can't be used to enumerate arbitrary conversations' participants. Audit 2026-04-28 — without path 3 a freshly-created conversation displayed "Unknown" until the recipient replied. |
| `Users update own participation` | UPDATE | Self | Update `last_read_at`, `cleared_at`, `is_archived`. |
| `Creator or staff adds participants` | INSERT | Creator or staff | Adding participants to a conversation. |

### `messages`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Participants read messages` | SELECT | Participants of the conversation | Standard messaging visibility. |
| `Participants send messages` | INSERT | Participants (as sender) | Sender must be `auth.uid()`. |

### `notifications`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `notifications: own read` | SELECT | Self | Inbox visibility. |
| `notifications: own update` | UPDATE | Self | Mark as read. |
| `notifications: admin read all` | SELECT | Admin | Admin troubleshooting. |
| `notifications: coord/admin insert` | INSERT | Coordinator/Admin (for their dept's volunteers) | Coordinators can notify their volunteers. |
| `notifications: volunteer self insert` | INSERT | Volunteer (only in narrow contexts where they trigger their own follow-up) | Edge case for volunteer-initiated webhooks. |

---

## Volunteer Attributes

### `volunteer_documents`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Volunteers read own documents` | SELECT | Volunteer (theirs) | Self-service view. |
| `Volunteers upload own documents` | INSERT | Volunteer (as self) | Upload flow. |
| `Volunteers delete own pending documents` | DELETE | Volunteer (theirs, status=pending_review) | Can retract before review starts. |
| `Coordinators and admins read all documents` | SELECT | Coordinator/Admin | Compliance review. |
| `Admins update documents` | UPDATE | Admin | Admin-only document review (approve/reject). |

### `document_types`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Authenticated users read active document types` | SELECT | Authenticated (active only) | Volunteers see what's required. |
| `Admins manage document types` | ALL | Admin | Catalog management. |

### `volunteer_preferences`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `preferences: volunteer own` | SELECT | Self | The recommendation engine reads this for the user. |
| `preferences: admin all` | ALL | Admin | Debug/inspect. |
| `preferences: system upsert/update` | INSERT/UPDATE | (anyone — `USING (true)`) | The trigger `trg_interaction_update_preferences` runs as the volunteer; allowing all updates is intentional because the trigger does the actual gating. |

### `volunteer_private_notes`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `private_notes: volunteer only` | ALL | Self | Private. Admin "break-glass" reads happen via service role and are audited in `private_note_access_log`. |

### `volunteer_shift_interactions`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `interactions: volunteer own` | SELECT | Self | Read own activity. |
| `interactions: volunteer insert` | INSERT | Self | Records own activity. |
| `interactions: admin all` | ALL | Admin | Admin oversight. |

---

## Auditing

### `admin_action_log`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `Admins can read all logs` | SELECT | Admin | Audit visibility. |
| `Service role can insert logs` | INSERT | Service role (`WITH CHECK (true)`) | Edge functions write here. No client INSERT path. |

### `private_note_access_log`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `break_glass_log: admin read` | SELECT | Admin | Read who-saw-what. |
| `break_glass_log: admin insert` | INSERT | Admin (as `admin_user_id`) | The break-glass UI inserts a row each time an admin reads a private note. |
| `break_glass_log: deny update` | UPDATE | (none — RESTRICTIVE) | Append-only. |
| `break_glass_log: deny delete` | DELETE | (none — RESTRICTIVE) | Append-only. |

---

## Events

### `events`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `events: all read active` | SELECT | Anyone (active only) | Public event listings. |
| `events: admin manage` | ALL | Admin | Admin manages events. |

### `event_registrations`

| Policy | Op | Allows | Why |
|---|---|---|---|
| `event_regs: volunteer own` | ALL | Volunteer (theirs) | Self-service registration. |
| `event_regs: admin read` | SELECT | Admin | Admin attendance views. |

---

## Notes for maintainers

- **`(supabase as any).rpc()` and RLS:** RPCs run as the caller (unless declared `SECURITY DEFINER`). The few `SECURITY DEFINER` RPCs in this codebase (waitlist accept, MFA flows) have explicit guards inside their function body — check the migration before changing them.
- **Service role bypasses RLS entirely.** Edge functions using the service-role key see every row. This is why `notification-webhook` can insert audit logs without a permissive policy.
- **`USING` vs `WITH CHECK`:** A policy without `WITH CHECK` allows any new row to be written if the existing row was visible. We've been deliberate to use both wherever the post-write predicate matters (e.g. `profiles: admin update any` has both halves identical to prevent role-laundering).

If you're adding a new table, replicate the conventions: a self-read policy, a self-write policy, and an explicit admin override. Don't rely on "authenticated" alone — every table that's ever held PII has at least three policies (self / staff / admin).
