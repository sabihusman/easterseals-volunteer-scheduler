-- =============================================
-- Enforce department scoping for coordinators on the shifts table.
--
-- The previous "shifts: coord/admin write" policy was ALL with a USING
-- clause of just is_coordinator_or_admin(), which let any coordinator
-- INSERT/UPDATE/DELETE any shift regardless of which department they
-- were assigned to in department_coordinators. Admins are unaffected.
-- =============================================

DROP POLICY IF EXISTS "shifts: coord/admin write" ON public.shifts;

-- INSERT: admins always; coordinators only if they're assigned to the department
CREATE POLICY "shifts: coord/admin insert"
  ON public.shifts FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_coordinator_or_admin()
      AND EXISTS (
        SELECT 1 FROM public.department_coordinators dc
        WHERE dc.department_id = shifts.department_id
          AND dc.coordinator_id = auth.uid()
      )
    )
  );

-- UPDATE: admins always; coordinators only on shifts in their assigned departments
CREATE POLICY "shifts: coord/admin update"
  ON public.shifts FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR (
      public.is_coordinator_or_admin()
      AND EXISTS (
        SELECT 1 FROM public.department_coordinators dc
        WHERE dc.department_id = shifts.department_id
          AND dc.coordinator_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_coordinator_or_admin()
      AND EXISTS (
        SELECT 1 FROM public.department_coordinators dc
        WHERE dc.department_id = shifts.department_id
          AND dc.coordinator_id = auth.uid()
      )
    )
  );

-- DELETE for coordinators on their own cancelled shifts already exists
-- via "shifts: coord delete cancelled". Admins already have
-- "shifts: admin delete". No DELETE policy change needed.
