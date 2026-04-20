-- Follow-up to PR #62 (20260415000000_shift_lifecycle_rules.sql).
-- Extends trg_enforce_completed_shift_immutability to also block updates
-- to `title` and `description` on completed shifts. Final blocked set:
-- shift_date, start_time, end_time, time_type, total_slots, department_id,
-- title, description.
--
-- The trigger itself is unchanged — we just CREATE OR REPLACE the function
-- it points at, so the existing BEFORE UPDATE trigger picks up the new
-- behavior automatically without needing to drop/recreate.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_completed_shift_immutability()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
  AS $$
BEGIN
  -- Only enforce when the pre-update state was 'completed'. This lets the
  -- normal open → full → completed transition flow through unchanged.
  IF OLD.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- Reject edits to the core scheduling fields once a shift is completed.
  -- Note: status itself is already protected by update_shift_status() which
  -- short-circuits on cancelled/completed.
  IF NEW.shift_date IS DISTINCT FROM OLD.shift_date THEN
    RAISE EXCEPTION 'Cannot edit shift_date on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    RAISE EXCEPTION 'Cannot edit start_time on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.end_time IS DISTINCT FROM OLD.end_time THEN
    RAISE EXCEPTION 'Cannot edit end_time on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.time_type IS DISTINCT FROM OLD.time_type THEN
    RAISE EXCEPTION 'Cannot edit time_type on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.total_slots IS DISTINCT FROM OLD.total_slots THEN
    RAISE EXCEPTION 'Cannot change total_slots on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    RAISE EXCEPTION 'Cannot reassign department_id on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;

  -- Added 2026-04-20: title and description are part of the shift's public
  -- identity. Once a shift is completed, the volunteer-facing name and
  -- description shown in history/reporting/exports must not drift from
  -- what was shown at the time the shift ran.
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    RAISE EXCEPTION 'Cannot edit title on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'Cannot edit description on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
