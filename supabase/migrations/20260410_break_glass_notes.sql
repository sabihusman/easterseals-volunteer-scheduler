-- =============================================
-- Break-glass access for volunteer private notes.
--
-- volunteer_private_notes has RLS that blocks all admin read access
-- by design. Easterseals leadership has approved an emergency
-- override for legal discovery and safety investigations.
--
-- Every access is:
--   1. Permanently logged in an append-only audit table
--   2. Requires a written reason (min 20 chars)
--   3. Triggers a notification to the volunteer (transparency)
-- =============================================

-- ── 1. Append-only audit table ──
CREATE TABLE IF NOT EXISTS public.private_note_access_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES public.profiles(id),
  volunteer_id  uuid NOT NULL REFERENCES public.profiles(id),
  note_id       uuid NOT NULL,
  access_reason text NOT NULL CHECK (char_length(access_reason) >= 20),
  accessed_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.private_note_access_log ENABLE ROW LEVEL SECURITY;

-- Admins can INSERT (log their own access) and SELECT (view the log).
-- No UPDATE or DELETE for anyone — append-only. Only service_role
-- (implicit RLS bypass) can delete rows for legal retention compliance.
DROP POLICY IF EXISTS "break_glass_log: admin insert" ON public.private_note_access_log;
CREATE POLICY "break_glass_log: admin insert"
  ON public.private_note_access_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND admin_user_id = auth.uid());

DROP POLICY IF EXISTS "break_glass_log: admin read" ON public.private_note_access_log;
CREATE POLICY "break_glass_log: admin read"
  ON public.private_note_access_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Explicitly deny UPDATE and DELETE for authenticated users.
-- These are RESTRICTIVE so even if a permissive policy exists,
-- the deny wins.
DROP POLICY IF EXISTS "break_glass_log: deny update" ON public.private_note_access_log;
CREATE POLICY "break_glass_log: deny update"
  ON public.private_note_access_log
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "break_glass_log: deny delete" ON public.private_note_access_log;
CREATE POLICY "break_glass_log: deny delete"
  ON public.private_note_access_log
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (false);

-- ── 2. Break-glass RPC ──
CREATE OR REPLACE FUNCTION public.admin_break_glass_read_notes(
  target_volunteer_id uuid,
  reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin_id    uuid;
  v_admin_email text;
  v_admin_name  text;
  v_vol_name    text;
  v_notes       jsonb;
  v_note        record;
BEGIN
  -- ── Verify caller is admin ──
  v_admin_id := auth.uid();
  SELECT role, email, full_name INTO STRICT v_admin_email, v_admin_email, v_admin_name
  FROM public.profiles
  WHERE id = v_admin_id;

  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: caller profile not found';
  END IF;

  -- Re-check role explicitly (SECURITY DEFINER bypasses RLS)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin role required for break-glass access';
  END IF;

  -- ── Validate reason ──
  IF reason IS NULL OR char_length(trim(reason)) < 20 THEN
    RAISE EXCEPTION 'Reason must be at least 20 characters. You provided: % chars', coalesce(char_length(trim(reason)), 0);
  END IF;

  -- ── Get volunteer name for the notification ──
  SELECT full_name INTO v_vol_name
  FROM public.profiles WHERE id = target_volunteer_id;

  IF v_vol_name IS NULL THEN
    RAISE EXCEPTION 'Volunteer not found: %', target_volunteer_id;
  END IF;

  -- ── Read the notes (bypasses RLS via SECURITY DEFINER) ──
  v_notes := '[]'::jsonb;
  FOR v_note IN
    SELECT n.id, n.title, n.content, n.shift_id, n.department_id,
           n.is_locked, n.created_at, n.updated_at,
           s.title AS shift_title,
           d.name AS department_name
    FROM public.volunteer_private_notes n
    LEFT JOIN public.shifts s ON s.id = n.shift_id
    LEFT JOIN public.departments d ON d.id = n.department_id
    WHERE n.volunteer_id = target_volunteer_id
    ORDER BY n.created_at DESC
  LOOP
    -- Log each note access individually
    INSERT INTO public.private_note_access_log
      (admin_user_id, volunteer_id, note_id, access_reason)
    VALUES
      (v_admin_id, target_volunteer_id, v_note.id, trim(reason));

    v_notes := v_notes || jsonb_build_object(
      'id', v_note.id,
      'title', v_note.title,
      'content', v_note.content,
      'shift_title', v_note.shift_title,
      'department_name', v_note.department_name,
      'is_locked', v_note.is_locked,
      'created_at', v_note.created_at
    );
  END LOOP;

  -- ── Get admin email for the notification ──
  SELECT email INTO v_admin_email
  FROM public.profiles WHERE id = v_admin_id;

  -- ── Notify the volunteer (transparency requirement) ──
  INSERT INTO public.notifications (user_id, type, title, message, link, is_read, data)
  VALUES (
    target_volunteer_id,
    'private_notes_accessed',
    'Your private notes were accessed',
    'An administrator accessed your private notes for the following reason: ' ||
      trim(reason) || '. Contact ' || coalesce(v_admin_email, 'an administrator') ||
      ' with questions.',
    '/notes',
    false,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'admin_email', v_admin_email,
      'reason', trim(reason),
      'notes_accessed', jsonb_array_length(v_notes)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'volunteer_name', v_vol_name,
    'notes_count', jsonb_array_length(v_notes),
    'notes', v_notes
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_break_glass_read_notes(uuid, text) TO authenticated;
