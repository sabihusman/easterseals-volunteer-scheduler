-- Coordinator/admin SELECT visibility on shifts in their own department,
-- regardless of status.
--
-- Why: the existing SELECT policies on `shifts` are:
--   1. "shifts: all read open"  — USING (status <> 'cancelled' AND ...)
--   2. "shifts: read booked"    — USING (has_active_booking_on(id))
--
-- Neither admits a `cancelled` shift to a coordinator who manages that
-- department. That gap surfaces in production as a misleading error:
-- when a coordinator UPDATEs a shift to status='cancelled', PostgREST
-- (and supabase-js's `.update().select()`) issue UPDATE ... RETURNING.
-- Postgres re-evaluates SELECT RLS against the new row to populate
-- RETURNING, finds no SELECT policy admits it, and reports
--   42501 / "new row violates row-level security policy for table 'shifts'"
-- — the same SQLSTATE used for genuine WITH CHECK violations.
--
-- This breaks the coordinator-facing soft-delete flow shipped in
-- PR #173: cancelShiftWithNotifications calls .update().select() and
-- falls into its 'error' branch, surfacing the raw 42501 message in a
-- toast. The same bug forced the harness to mark the positive-case
-- shift-cancel RLS test as it.skip — see supabase/test/shift-cancel-rls.test.ts.
--
-- Fix: add a permissive SELECT policy that lets a coordinator (or any
-- admin) see every shift in a department they manage, regardless of
-- status. Visibility is strictly narrower than the existing UPDATE/
-- INSERT/DELETE rights these roles already have on the same rows, so
-- this does not broaden the security model — it closes a visibility
-- gap that was masquerading as a write-side denial.
--
-- Combined with the two existing SELECT policies via OR (Postgres
-- permissive-policy semantics), volunteers' visibility is unchanged.

CREATE POLICY "shifts: coord/admin read all"
  ON public.shifts
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR (
      public.is_coordinator_or_admin()
      AND EXISTS (
        SELECT 1
        FROM public.department_coordinators dc
        WHERE dc.department_id = shifts.department_id
          AND dc.coordinator_id = auth.uid()
      )
    )
  );
