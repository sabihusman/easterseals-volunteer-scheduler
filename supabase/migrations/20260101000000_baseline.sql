


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


-- Extensions required by baseline (not enabled in default local Supabase stack)
CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "public";



CREATE TYPE "public"."bg_check_status" AS ENUM (
    'pending',
    'cleared',
    'failed',
    'expired'
);


ALTER TYPE "public"."bg_check_status" OWNER TO "postgres";


CREATE TYPE "public"."booking_status" AS ENUM (
    'confirmed',
    'cancelled',
    'waitlisted'
);


ALTER TYPE "public"."booking_status" OWNER TO "postgres";


CREATE TYPE "public"."confirmation_status" AS ENUM (
    'pending_confirmation',
    'confirmed',
    'no_show'
);


ALTER TYPE "public"."confirmation_status" OWNER TO "postgres";


CREATE TYPE "public"."interaction_type" AS ENUM (
    'viewed',
    'signed_up',
    'cancelled',
    'completed',
    'no_show'
);


ALTER TYPE "public"."interaction_type" OWNER TO "postgres";


CREATE TYPE "public"."recurrence_type" AS ENUM (
    'daily',
    'weekly',
    'biweekly',
    'monthly'
);


ALTER TYPE "public"."recurrence_type" OWNER TO "postgres";


CREATE TYPE "public"."reminder_recipient" AS ENUM (
    'coordinator',
    'admin'
);


ALTER TYPE "public"."reminder_recipient" OWNER TO "postgres";


CREATE TYPE "public"."self_confirm_status" AS ENUM (
    'pending',
    'attended',
    'no_show'
);


ALTER TYPE "public"."self_confirm_status" OWNER TO "postgres";


CREATE TYPE "public"."shift_status" AS ENUM (
    'open',
    'full',
    'cancelled',
    'completed'
);


ALTER TYPE "public"."shift_status" OWNER TO "postgres";


CREATE TYPE "public"."shift_time_type" AS ENUM (
    'morning',
    'afternoon',
    'all_day',
    'custom'
);


ALTER TYPE "public"."shift_time_type" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'volunteer',
    'coordinator',
    'admin'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_action_off_shift"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_duration_hours numeric;
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT sb.volunteer_id, sb.shift_id INTO v_volunteer_id, v_shift_id
    FROM public.shift_bookings sb WHERE sb.id = p_booking_id;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  SELECT GREATEST(0.5, ROUND(EXTRACT(EPOCH FROM (
    public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
    - ((s.shift_date::text || ' ' || COALESCE(
          s.start_time::text,
          CASE s.time_type::text
            WHEN 'morning'   THEN '09:00:00'
            WHEN 'afternoon' THEN '13:00:00'
            WHEN 'all_day'   THEN '09:00:00'
            ELSE '09:00:00'
          END
        ))::timestamp AT TIME ZONE 'America/Chicago')
  )) / 3600.0, 2))
  INTO v_duration_hours
  FROM public.shifts s WHERE s.id = v_shift_id;

  INSERT INTO public.volunteer_shift_reports
    (booking_id, volunteer_id, self_confirm_status, self_reported_hours, submitted_at)
  VALUES
    (p_booking_id, v_volunteer_id, 'attended', v_duration_hours, now())
  ON CONFLICT (booking_id) DO UPDATE SET
    self_confirm_status = 'attended',
    self_reported_hours = COALESCE(public.volunteer_shift_reports.self_reported_hours, EXCLUDED.self_reported_hours),
    submitted_at = COALESCE(public.volunteer_shift_reports.submitted_at, now()),
    updated_at = now();

  UPDATE public.shift_bookings
  SET confirmation_status = 'confirmed',
      final_hours = COALESCE(final_hours, v_duration_hours),
      hours_source = COALESCE(hours_source, 'admin_action_off'),
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
  SELECT
    v_volunteer_id,
    'booking_changed',
    'Shift marked complete',
    'Your shift "' || s.title || '" on ' || to_char(s.shift_date, 'Mon DD') ||
      ' has been marked complete by staff. Your volunteer hours have been recorded.',
    '/history',
    false
  FROM public.shifts s WHERE s.id = v_shift_id;
END;
$$;


ALTER FUNCTION "public"."admin_action_off_shift"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_break_glass_read_notes"("target_volunteer_id" "uuid", "reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."admin_break_glass_read_notes"("target_volunteer_id" "uuid", "reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_unactioned_shift"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.shift_bookings WHERE id = p_booking_id;
END;
$$;


ALTER FUNCTION "public"."admin_delete_unactioned_shift"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_emergency_mfa_reset"("target_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_user_id    uuid;
  v_user_email text;
  v_factors    int;
  v_caller     text;
BEGIN
  -- ── Guard: only service_role can call this ──
  -- When called via PostgREST with the service_role key, the
  -- current_setting('request.jwt.claim.role') is 'service_role'.
  -- Any other caller (anon, authenticated) is rejected.
  v_caller := coalesce(
    current_setting('request.jwt.claim.role', true),
    'unknown'
  );
  IF v_caller != 'service_role' THEN
    RAISE EXCEPTION 'admin_emergency_mfa_reset requires service_role key. Current role: %', v_caller;
  END IF;

  -- ── Find the user ──
  SELECT id, email INTO v_user_id, v_user_email
  FROM auth.users
  WHERE email = target_email;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No user found with email: ' || target_email
    );
  END IF;

  -- ── Delete all MFA factors ──
  DELETE FROM auth.mfa_factors
  WHERE user_id = v_user_id;

  GET DIAGNOSTICS v_factors = ROW_COUNT;

  -- ── Also clear the app-level MFA fields on profiles ──
  UPDATE public.profiles
  SET mfa_enabled = false,
      mfa_secret = NULL,
      mfa_backup_codes = NULL,
      updated_at = now()
  WHERE id = v_user_id;

  -- ── Audit log ──
  INSERT INTO public.admin_mfa_resets (
    reset_by, target_user_id, target_email, reset_method, notes
  ) VALUES (
    'service_role',
    v_user_id,
    v_user_email,
    'rpc',
    'Cleared ' || v_factors || ' MFA factor(s) via admin_emergency_mfa_reset RPC'
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', v_user_email,
    'factors_deleted', v_factors,
    'message', 'MFA factors cleared. User can now sign in without MFA and should re-enroll immediately.'
  );
END;
$$;


ALTER FUNCTION "public"."admin_emergency_mfa_reset"("target_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_shift_hours"("p_booking_id" "uuid", "p_hours" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_max_hours numeric;
  v_start time;
  v_end   time;
  v_time_type text;
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_hours IS NULL OR p_hours < 0 THEN
    RAISE EXCEPTION 'hours must be 0 or greater';
  END IF;

  SELECT sb.volunteer_id, sb.shift_id
    INTO v_volunteer_id, v_shift_id
    FROM public.shift_bookings sb
    WHERE sb.id = p_booking_id;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  -- Cap at shift duration + 30 minutes early-checkin grace
  SELECT s.start_time, s.end_time, s.time_type::text
    INTO v_start, v_end, v_time_type
    FROM public.shifts s
    WHERE s.id = v_shift_id;

  v_max_hours := CASE
    WHEN v_start IS NOT NULL AND v_end IS NOT NULL
      THEN EXTRACT(EPOCH FROM (v_end - v_start)) / 3600.0
    WHEN v_time_type IN ('morning', 'afternoon') THEN 4
    ELSE 8
  END + 0.5;  -- 30 min grace for early check-in

  IF p_hours > v_max_hours THEN
    RAISE EXCEPTION 'hours cannot exceed shift duration (max %)', v_max_hours;
  END IF;

  -- Update the booking
  UPDATE public.shift_bookings
  SET final_hours = p_hours,
      coordinator_reported_hours = p_hours,
      hours_source = 'coordinator',
      updated_at = now()
  WHERE id = p_booking_id;

  -- Recompute profiles.total_hours for this volunteer
  UPDATE public.profiles
  SET total_hours = (
    SELECT COALESCE(SUM(final_hours), 0)
    FROM public.shift_bookings
    WHERE volunteer_id = v_volunteer_id
      AND confirmation_status = 'confirmed'
      AND final_hours IS NOT NULL
  ),
  updated_at = now()
  WHERE id = v_volunteer_id;

  -- Recompute volunteer_points (reads final_hours we just wrote)
  PERFORM public.recalculate_points(v_volunteer_id);
END;
$$;


ALTER FUNCTION "public"."admin_update_shift_hours"("p_booking_id" "uuid", "p_hours" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_bookings_on_profile_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Only cancel bookings if deleted user was a volunteer
  if old.role = 'volunteer' then
    update public.shift_bookings
    set booking_status = 'cancelled',
        cancelled_at   = now(),
        updated_at     = now()
    where volunteer_id = old.id
      and booking_status = 'confirmed';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "public"."cancel_bookings_on_profile_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cascade_bg_check_expiry"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF (NEW.bg_check_status IN ('expired', 'failed'))
     AND (OLD.bg_check_status IS DISTINCT FROM NEW.bg_check_status) THEN
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled', cancelled_at = now(), updated_at = now()
    FROM public.shifts s
    WHERE sb.shift_id = s.id AND sb.volunteer_id = NEW.id
      AND sb.booking_status = 'confirmed' AND s.shift_date > CURRENT_DATE
      AND (s.requires_bg_check = true OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.department_id AND d.requires_bg_check = true));
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled', cancelled_at = now(), updated_at = now()
    FROM public.shifts s
    WHERE sb.shift_id = s.id AND sb.volunteer_id = NEW.id
      AND sb.booking_status = 'waitlisted' AND s.shift_date >= CURRENT_DATE
      AND (s.requires_bg_check = true OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.department_id AND d.requires_bg_check = true));
    INSERT INTO public.notifications (user_id, title, message, type, link, is_read)
    SELECT dc.coordinator_id, 'BG Check Alert: ' || NEW.full_name,
      NEW.full_name || '''s background check has ' || NEW.bg_check_status || '. They have a shift TODAY that requires a BG check.',
      'bg_check_status_change', '/coordinator', false
    FROM public.shift_bookings sb
    JOIN public.shifts s ON sb.shift_id = s.id
    JOIN public.department_coordinators dc ON dc.department_id = s.department_id
    WHERE sb.volunteer_id = NEW.id AND sb.booking_status = 'confirmed' AND s.shift_date = CURRENT_DATE
      AND (s.requires_bg_check = true OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.department_id AND d.requires_bg_check = true));
    INSERT INTO public.notifications (user_id, title, message, type, link, is_read)
    VALUES (NEW.id, 'Background Check Status Changed',
      'Your background check status has changed to ' || NEW.bg_check_status || '. Future shifts and waitlist entries requiring a BG check have been cancelled.',
      'bg_check_status_change', '/dashboard', false);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."cascade_bg_check_expiry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_attendance_dispute"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vol_status text;
  v_vol_hours numeric;
  v_shift_duration numeric;
  v_shift_title text;
  v_shift_date date;
  v_vol_name text;
  v_coord_name text;
BEGIN
  IF NEW.coordinator_status IS NULL THEN RETURN NEW; END IF;
  IF OLD.coordinator_status IS NOT NULL THEN RETURN NEW; END IF;

  NEW.coordinator_actioned_at := now();

  SELECT vsr.self_confirm_status, vsr.self_reported_hours
    INTO v_vol_status, v_vol_hours
    FROM public.volunteer_shift_reports vsr
    WHERE vsr.booking_id = NEW.id AND vsr.submitted_at IS NOT NULL
    LIMIT 1;

  SELECT s.title, s.shift_date,
         GREATEST(0.5, ROUND(EXTRACT(EPOCH FROM (
           public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
           - public.shift_start_at(s.shift_date, s.start_time, s.time_type::text)
         )) / 3600.0, 2))
    INTO v_shift_title, v_shift_date, v_shift_duration
    FROM public.shifts s WHERE s.id = NEW.shift_id;

  IF NEW.coordinator_status = 'attended' THEN
    NEW.confirmation_status := 'confirmed';
    NEW.final_hours := COALESCE(v_vol_hours, v_shift_duration);
    NEW.hours_source := COALESCE(NEW.hours_source, 'coordinator');
    RETURN NEW;
  END IF;

  IF NEW.coordinator_status = 'absent' THEN
    IF v_vol_status = 'attended' THEN
      SELECT full_name INTO v_vol_name FROM public.profiles WHERE id = NEW.volunteer_id;
      SELECT full_name INTO v_coord_name FROM public.profiles WHERE id = NEW.coordinator_actioned_by;

      INSERT INTO public.attendance_disputes (
        booking_id, shift_id, volunteer_id, coordinator_id,
        volunteer_status, volunteer_reported_hours, coordinator_status
      ) VALUES (
        NEW.id, NEW.shift_id, NEW.volunteer_id, NEW.coordinator_actioned_by,
        'attended', v_vol_hours, 'absent'
      );

      INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
      SELECT p.id, 'attendance_dispute',
        'Attendance dispute: ' || COALESCE(v_vol_name, 'Volunteer'),
        COALESCE(v_coord_name, 'A coordinator') || ' marked ' || COALESCE(v_vol_name, 'a volunteer') ||
          ' as absent for "' || COALESCE(v_shift_title, 'shift') || '" on ' ||
          to_char(v_shift_date, 'Mon DD') || ', but the volunteer reported attending. Admin review required.',
        jsonb_build_object('booking_id', NEW.id, 'shift_id', NEW.shift_id,
          'volunteer_id', NEW.volunteer_id, 'volunteer_name', v_vol_name,
          'coordinator_name', v_coord_name, 'shift_title', v_shift_title, 'shift_date', v_shift_date),
        '/admin/disputes', false
      FROM public.profiles p WHERE p.role = 'admin' AND p.is_active = true;
    ELSE
      NEW.confirmation_status := 'no_show';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_attendance_dispute"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_notifications_for_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM public.notifications n
   WHERE (
       -- data-based references
       (n.data ? 'booking_id' AND (n.data->>'booking_id')::uuid = OLD.id)
     OR
       -- link-based references
       (n.link IS NOT NULL AND public.notification_link_booking_id(n.link) = OLD.id)
   );
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."cleanup_notifications_for_booking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_notifications_for_shift"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM public.notifications n
   WHERE (n.data ? 'shift_id' AND (n.data->>'shift_id')::uuid = OLD.id);
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."cleanup_notifications_for_shift"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_self_confirmation_report"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.confirmation_status = 'confirmed' 
     and old.confirmation_status = 'pending_confirmation' then
    insert into public.volunteer_shift_reports 
      (booking_id, volunteer_id, self_confirm_status)
    values (new.id, new.volunteer_id, 'pending')
    on conflict (booking_id) do nothing;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."create_self_confirmation_report"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_admin_cap"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare admin_count int;
begin
  if new.role = 'admin' then
    -- Use advisory lock to prevent race condition
    perform pg_advisory_xact_lock(hashtext('admin_cap_lock'));
    select count(*) into admin_count
    from public.profiles
    where role = 'admin' and id != new.id;
    if admin_count >= 2 then
      raise exception 'Maximum of 2 admins allowed. Transfer an existing admin role first.';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_admin_cap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_booking_window"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  shift_rec  record;
  max_days   int;
  vol        public.profiles%rowtype;
BEGIN
  SELECT * INTO vol FROM public.profiles WHERE id = NEW.volunteer_id;

  -- Emergency contact gate
  IF vol.emergency_contact_name IS NULL OR TRIM(vol.emergency_contact_name) = '' THEN
    RAISE EXCEPTION 'Emergency contact required. Please add an emergency contact name in your profile settings before booking a shift.';
  END IF;
  IF vol.emergency_contact_phone IS NULL OR TRIM(vol.emergency_contact_phone) = '' THEN
    RAISE EXCEPTION 'Emergency contact required. Please add an emergency contact phone number in your profile settings before booking a shift.';
  END IF;

  -- Minor consent gate
  IF vol.is_minor THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.parental_consents
      WHERE volunteer_id = NEW.volunteer_id
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      RAISE EXCEPTION 'Parental consent required before minors can book shifts. Please ask your parent or guardian to complete the consent form in your profile settings.';
    END IF;
  END IF;

  SELECT s.shift_date, s.start_time, s.end_time, s.requires_bg_check,
         d.requires_bg_check AS dept_bg_check
  INTO shift_rec
  FROM public.shifts s
  JOIN public.departments d ON d.id = s.department_id
  WHERE s.id = NEW.shift_id;

  -- Background check enforcement
  IF shift_rec.requires_bg_check OR shift_rec.dept_bg_check THEN
    IF vol.bg_check_status != 'cleared' THEN
      RAISE EXCEPTION 'This shift requires a cleared background check. Your current status is: %', vol.bg_check_status;
    END IF;
    IF vol.bg_check_expires_at IS NOT NULL AND vol.bg_check_expires_at < now() THEN
      RAISE EXCEPTION 'Your background check has expired. Please renew before booking this shift.';
    END IF;
  END IF;

  -- Booking window enforcement
  max_days := CASE WHEN vol.extended_booking THEN 21 ELSE 14 END;
  IF (shift_rec.shift_date - current_date) > max_days THEN
    RAISE EXCEPTION 'Booking window exceeded. You can book up to % days in advance.', max_days;
  END IF;
  IF shift_rec.shift_date < current_date THEN
    RAISE EXCEPTION 'Cannot book a shift in the past.';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_booking_window"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_department_restriction"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare dept_id uuid;
begin
  select s.department_id into dept_id
  from public.shifts s where s.id = new.shift_id;

  if exists (
    select 1 from public.department_restrictions dr
    where dr.volunteer_id = new.volunteer_id
      and dr.department_id = dept_id
  ) then
    raise exception 'You are not currently able to book shifts in this department.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_department_restriction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_eligibility_on_profile_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  -- If booking privileges revoked, cancel all future confirmed bookings
  if new.booking_privileges = false and old.booking_privileges = true then
    update public.shift_bookings sb
    set booking_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    from public.shifts s
    where sb.shift_id = s.id
      and sb.volunteer_id = new.id
      and sb.booking_status = 'confirmed'
      and s.shift_date >= current_date;

    insert into public.notifications (user_id, type, title, message, link)
    values (
      new.id,
      'booking_privileges_revoked',
      'Booking Privileges Revoked',
      'Your booking privileges have been revoked by an administrator. Your upcoming shift bookings have been cancelled. Please contact your coordinator.',
      '/my-shifts'
    );
  end if;

  -- If BG check fails or expires, cancel gated shift bookings
  if new.bg_check_status in ('failed','expired')
     and old.bg_check_status not in ('failed','expired') then
    update public.shift_bookings sb
    set booking_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    from public.shifts s
    where sb.shift_id = s.id
      and sb.volunteer_id = new.id
      and sb.booking_status = 'confirmed'
      and s.shift_date >= current_date
      and s.requires_bg_check = true;

    insert into public.notifications (user_id, type, title, message, link)
    values (
      new.id,
      'bg_check_status_changed',
      'Background Check Status Changed',
      'Your background check status is now ' || new.bg_check_status || '. Bookings for shifts requiring a background check have been cancelled.',
      '/my-shifts'
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_eligibility_on_profile_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_shift_not_ended_on_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_end timestamptz;
  v_time_type text;
  v_shift_date date;
  v_end_time time;
BEGIN
  -- Allow cancellations and other non-active transitions through unconditionally
  IF NEW.booking_status NOT IN ('confirmed', 'waitlisted') THEN
    RETURN NEW;
  END IF;

  -- Active -> active updates (e.g. admin_action_off_shift which only
  -- changes confirmation_status) are exempt. Re-validating end time on
  -- these would incorrectly block legitimate flows for shifts that have
  -- already ended.
  IF TG_OP = 'UPDATE'
     AND OLD.booking_status IN ('confirmed', 'waitlisted')
     AND NEW.booking_status IN ('confirmed', 'waitlisted') THEN
    RETURN NEW;
  END IF;

  SELECT s.shift_date, s.end_time, s.time_type::text
    INTO v_shift_date, v_end_time, v_time_type
    FROM public.shifts s
   WHERE s.id = NEW.shift_id;

  IF v_shift_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_end := public.shift_end_at(v_shift_date, v_end_time, v_time_type);

  IF v_end <= now() THEN
    RAISE EXCEPTION 'Cannot book a shift that has already ended'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_shift_not_ended_on_booking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_volunteer_only_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  booker_role public.user_role;
begin
  select role into booker_role 
  from public.profiles 
  where id = new.volunteer_id;

  if booker_role in ('coordinator', 'admin') then
    raise exception 'Coordinators and admins cannot book shifts as volunteers.';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_volunteer_only_booking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."export_critical_data"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  return json_build_object(
    'profiles', (select json_agg(p) from public.profiles p),
    'departments', (select json_agg(d) from public.departments d),
    'shifts', (select json_agg(s) from public.shifts s),
    'shift_bookings', (select json_agg(sb) from public.shift_bookings sb),
    'exported_at', now()
  );
end;
$$;


ALTER FUNCTION "public"."export_critical_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_shift_time_slots"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  slot_start time;
  slot_end   time;
BEGIN
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN RETURN NEW; END IF;
  IF NEW.end_time <= NEW.start_time THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.start_time IS DISTINCT FROM NEW.start_time
       OR OLD.end_time IS DISTINCT FROM NEW.end_time
       OR OLD.total_slots IS DISTINCT FROM NEW.total_slots THEN
      slot_start := NEW.start_time;
      WHILE slot_start < NEW.end_time LOOP
        slot_end := LEAST(slot_start + interval '2 hours', NEW.end_time);
        INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
        VALUES (NEW.id, slot_start, slot_end, NEW.total_slots)
        ON CONFLICT (shift_id, slot_start, slot_end)
        DO UPDATE SET total_slots = EXCLUDED.total_slots;
        slot_start := slot_end;
      END LOOP;
      DELETE FROM public.shift_time_slots
      WHERE shift_id = NEW.id
        AND (slot_start < NEW.start_time
             OR slot_end > NEW.end_time
             OR MOD(EXTRACT(EPOCH FROM (slot_start - NEW.start_time))::int, 7200) != 0);
    END IF;
  ELSE
    slot_start := NEW.start_time;
    WHILE slot_start < NEW.end_time LOOP
      slot_end := LEAST(slot_start + interval '2 hours', NEW.end_time);
      INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
      VALUES (NEW.id, slot_start, slot_end, NEW.total_slots);
      slot_start := slot_end;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_shift_time_slots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") RETURNS TABLE("department_id" "uuid", "department_name" "text", "total_shifts" integer, "total_confirmed" integer, "total_no_shows" integer, "total_cancellations" integer, "total_waitlisted" integer, "avg_fill_rate" numeric, "attendance_rate" numeric, "rated_shift_count" integer, "avg_rating" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH shift_metrics AS (
    SELECT
      s.department_id,
      s.id AS sid,
      s.total_slots,
      COUNT(sb.id) FILTER (WHERE sb.booking_status = 'confirmed') AS confirmed,
      COUNT(sb.id) FILTER (WHERE sb.confirmation_status = 'confirmed') AS attended,
      COUNT(sb.id) FILTER (WHERE sb.confirmation_status = 'no_show') AS no_shows,
      COUNT(sb.id) FILTER (WHERE sb.booking_status = 'cancelled') AS cancelled,
      COUNT(sb.id) FILTER (WHERE sb.booking_status = 'waitlisted') AS waitlisted
    FROM public.shifts s
    LEFT JOIN public.shift_bookings sb ON sb.shift_id = s.id
    WHERE s.department_id = ANY(dept_uuids)
      AND s.shift_date BETWEEN date_from AND date_to
      AND s.status != 'cancelled'
    GROUP BY s.department_id, s.id, s.total_slots
  ),
  rating_metrics AS (
    SELECT
      s.department_id,
      s.id AS sid,
      AVG(vsr.star_rating) AS shift_avg,
      COUNT(vsr.star_rating) AS rating_n
    FROM public.shifts s
    JOIN public.shift_bookings sb ON sb.shift_id = s.id
    JOIN public.volunteer_shift_reports vsr ON vsr.booking_id = sb.id
    WHERE s.department_id = ANY(dept_uuids)
      AND s.shift_date BETWEEN date_from AND date_to
      AND s.status != 'cancelled'
      AND vsr.star_rating IS NOT NULL
    GROUP BY s.department_id, s.id
    HAVING COUNT(vsr.star_rating) >= 2
  )
  SELECT
    d.id,
    d.name,
    COUNT(DISTINCT sm.sid)::integer AS total_shifts,
    COALESCE(SUM(sm.confirmed), 0)::integer AS total_confirmed,
    COALESCE(SUM(sm.no_shows), 0)::integer AS total_no_shows,
    COALESCE(SUM(sm.cancelled), 0)::integer AS total_cancellations,
    COALESCE(SUM(sm.waitlisted), 0)::integer AS total_waitlisted,
    CASE WHEN SUM(sm.total_slots) > 0
      THEN ROUND((SUM(sm.confirmed)::numeric / SUM(sm.total_slots)::numeric) * 100, 2)
      ELSE 0
    END AS avg_fill_rate,
    CASE WHEN (SUM(sm.attended) + SUM(sm.no_shows)) > 0
      THEN ROUND((SUM(sm.attended)::numeric / NULLIF((SUM(sm.attended) + SUM(sm.no_shows)), 0)::numeric) * 100, 2)
      ELSE 0
    END AS attendance_rate,
    COUNT(DISTINCT rm.sid)::integer AS rated_shift_count,
    CASE WHEN COUNT(DISTINCT rm.sid) > 0
      THEN ROUND(AVG(rm.shift_avg)::numeric, 2)
      ELSE 0
    END AS avg_rating
  FROM public.departments d
  LEFT JOIN shift_metrics sm ON sm.department_id = d.id
  LEFT JOIN rating_metrics rm ON rm.department_id = d.id
  WHERE d.id = ANY(dept_uuids)
  GROUP BY d.id, d.name;
END;
$$;


ALTER FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_email_by_username"("p_username" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_email text;
  v_dummy text;
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    -- Still pay the delay so empty input can't be distinguished by timing.
    PERFORM pg_sleep(0.03);
    RETURN NULL;
  END IF;

  -- Real lookup.
  SELECT email
    INTO v_email
    FROM public.profiles
    WHERE lower(username) = lower(trim(p_username))
    LIMIT 1;

  -- Constant-time companion read: do a second lookup against the same
  -- index regardless of outcome so the work performed is the same shape.
  -- Combined with the pg_sleep below, this neutralizes the timing oracle.
  SELECT email
    INTO v_dummy
    FROM public.profiles
    WHERE lower(username) = '__nonexistent_username_for_timing__'
    LIMIT 1;

  -- Fixed floor on response time. 30ms is well above the variance of
  -- the underlying index lookup so timing differences become noise.
  PERFORM pg_sleep(0.03);

  RETURN v_email;
END;
$$;


ALTER FUNCTION "public"."get_email_by_username"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_shift_consistency"("shift_uuids" "uuid"[]) RETURNS TABLE("shift_id" "uuid", "total_bookings" integer, "attended" integer, "no_shows" integer, "cancelled" integer, "attendance_rate" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sb.shift_id,
    COUNT(*) FILTER (WHERE sb.booking_status IN ('confirmed', 'cancelled'))::integer AS total_bookings,
    COUNT(*) FILTER (WHERE sb.confirmation_status = 'confirmed')::integer AS attended,
    COUNT(*) FILTER (WHERE sb.confirmation_status = 'no_show')::integer AS no_shows,
    COUNT(*) FILTER (WHERE sb.booking_status = 'cancelled')::integer AS cancelled,
    CASE WHEN COUNT(*) FILTER (WHERE sb.booking_status IN ('confirmed', 'cancelled')) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE sb.confirmation_status = 'confirmed')::numeric
         / NULLIF(COUNT(*) FILTER (WHERE sb.booking_status IN ('confirmed', 'cancelled')), 0)::numeric)
        * 100, 2)
      ELSE 0
    END AS attendance_rate
  FROM public.shift_bookings sb
  WHERE sb.shift_id = ANY(shift_uuids)
  GROUP BY sb.shift_id;
END;
$$;


ALTER FUNCTION "public"."get_shift_consistency"("shift_uuids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_shift_popularity"("shift_uuids" "uuid"[]) RETURNS TABLE("shift_id" "uuid", "confirmed_count" integer, "waitlist_count" integer, "view_count" integer, "fill_ratio" numeric, "popularity_score" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH shift_data AS (
    SELECT
      s.id,
      s.total_slots,
      COALESCE(SUM(CASE WHEN sb.booking_status = 'confirmed' THEN 1 ELSE 0 END), 0)::integer AS confirmed,
      COALESCE(SUM(CASE WHEN sb.booking_status = 'waitlisted' THEN 1 ELSE 0 END), 0)::integer AS waitlisted
    FROM public.shifts s
    LEFT JOIN public.shift_bookings sb ON sb.shift_id = s.id
    WHERE s.id = ANY(shift_uuids)
    GROUP BY s.id, s.total_slots
  ),
  view_data AS (
    SELECT vsi.shift_id, COUNT(*)::integer AS views
    FROM public.volunteer_shift_interactions vsi
    WHERE vsi.shift_id = ANY(shift_uuids)
      AND vsi.interaction_type = 'viewed'
    GROUP BY vsi.shift_id
  )
  SELECT
    sd.id,
    sd.confirmed,
    sd.waitlisted,
    COALESCE(vd.views, 0),
    CASE WHEN sd.total_slots > 0 THEN ROUND((sd.confirmed::numeric / sd.total_slots::numeric), 2) ELSE 0 END,
    -- Popularity score: fill rate (0-1) + waitlist demand bonus (0.1 per waitlist) + view normalized (cap 1.0)
    -- Formula prioritizes shifts that fill up AND have waitlists
    ROUND(
      (CASE WHEN sd.total_slots > 0 THEN (sd.confirmed::numeric / sd.total_slots::numeric) ELSE 0 END
        + (sd.waitlisted * 0.1)
        + LEAST(COALESCE(vd.views, 0)::numeric / 20.0, 1.0) * 0.2
      )::numeric,
      2
    )
  FROM shift_data sd
  LEFT JOIN view_data vd ON vd.shift_id = sd.id;
END;
$$;


ALTER FUNCTION "public"."get_shift_popularity"("shift_uuids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_shift_rating_aggregates"("shift_uuids" "uuid"[]) RETURNS TABLE("shift_id" "uuid", "avg_rating" numeric, "rating_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sb.shift_id,
    ROUND(AVG(vsr.star_rating)::numeric, 1) AS avg_rating,
    COUNT(vsr.star_rating)::integer AS rating_count
  FROM public.volunteer_shift_reports vsr
  JOIN public.shift_bookings sb ON sb.id = vsr.booking_id
  WHERE sb.shift_id = ANY(shift_uuids)
    AND vsr.star_rating IS NOT NULL
  GROUP BY sb.shift_id
  HAVING COUNT(vsr.star_rating) >= 2;
END;
$$;


ALTER FUNCTION "public"."get_shift_rating_aggregates"("shift_uuids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unactioned_shifts"() RETURNS TABLE("booking_id" "uuid", "shift_id" "uuid", "volunteer_id" "uuid", "volunteer_name" "text", "volunteer_email" "text", "shift_title" "text", "shift_date" "date", "department_name" "text", "checked_in" boolean, "actioned_off" boolean, "shift_end" timestamp with time zone, "hours_since_end" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sb.id AS booking_id,
    s.id AS shift_id,
    p.id AS volunteer_id,
    p.full_name AS volunteer_name,
    p.email AS volunteer_email,
    s.title AS shift_title,
    s.shift_date,
    d.name AS department_name,
    (sb.checked_in_at IS NOT NULL) AS checked_in,
    EXISTS (
      SELECT 1 FROM public.volunteer_shift_reports vsr
      WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL
    ) AS actioned_off,
    public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) AS shift_end,
    EXTRACT(EPOCH FROM (now() - public.shift_end_at(s.shift_date, s.end_time, s.time_type::text))) / 3600.0 AS hours_since_end
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  JOIN public.profiles p ON p.id = sb.volunteer_id
  LEFT JOIN public.departments d ON d.id = s.department_id
  WHERE sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) < now()
    AND (
      sb.checked_in_at IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.volunteer_shift_reports vsr2
        WHERE vsr2.booking_id = sb.id AND vsr2.submitted_at IS NOT NULL
      )
    )
  ORDER BY public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) ASC;
END;
$$;


ALTER FUNCTION "public"."get_unactioned_shifts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unread_conversation_count"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(COUNT(DISTINCT cp.conversation_id), 0)::integer
  FROM public.conversation_participants cp
  JOIN public.messages m
    ON m.conversation_id = cp.conversation_id
    AND m.sender_id <> cp.user_id
    AND m.created_at > GREATEST(
      cp.last_read_at,
      COALESCE(cp.cleared_at, 'epoch'::timestamptz)
    )
  WHERE cp.user_id = auth.uid()
    AND cp.is_archived = false;
$$;


ALTER FUNCTION "public"."get_unread_conversation_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_active_booking_on"("p_shift_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shift_bookings
    WHERE shift_id = p_shift_id
      AND volunteer_id = auth.uid()
      AND booking_status IN ('confirmed', 'waitlisted')
  );
$$;


ALTER FUNCTION "public"."has_active_booking_on"("p_shift_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_coordinator_for_my_dept"("p_coordinator_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.department_coordinators dc
    JOIN public.shifts s             ON s.department_id = dc.department_id
    JOIN public.shift_bookings sb    ON sb.shift_id = s.id
    WHERE dc.coordinator_id = p_coordinator_id
      AND sb.volunteer_id   = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_coordinator_for_my_dept"("p_coordinator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_coordinator_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('coordinator','admin'));
$$;


ALTER FUNCTION "public"."is_coordinator_or_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_mfa_reset"("target_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_user_id uuid;
  v_caller  text;
BEGIN
  v_caller := coalesce(
    current_setting('request.jwt.claim.role', true),
    'unknown'
  );
  IF v_caller != 'service_role' THEN
    RAISE EXCEPTION 'log_mfa_reset requires service_role key. Current role: %', v_caller;
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = target_email;

  INSERT INTO public.admin_mfa_resets (target_user_id, target_email, reset_method)
  VALUES (
    coalesce(v_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    target_email,
    'edge_function'
  );
END;
$$;


ALTER FUNCTION "public"."log_mfa_reset"("target_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mfa_consume_backup_code"("p_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hash text;
  v_match_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_code IS NULL OR length(trim(p_code)) = 0 THEN
    PERFORM pg_sleep(0.03);
    RETURN false;
  END IF;

  v_hash := encode(
    digest(upper(trim(p_code)) || v_user_id::text, 'sha256'),
    'hex'
  );

  SELECT id INTO v_match_id
    FROM public.mfa_backup_codes
    WHERE user_id = v_user_id
      AND code_hash = v_hash
      AND used_at IS NULL
    FOR UPDATE
    LIMIT 1;

  IF v_match_id IS NULL THEN
    PERFORM pg_sleep(0.03);
    RETURN false;
  END IF;

  UPDATE public.mfa_backup_codes
    SET used_at = now()
    WHERE id = v_match_id;

  PERFORM pg_sleep(0.03);
  RETURN true;
END;
$$;


ALTER FUNCTION "public"."mfa_consume_backup_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mfa_generate_backup_codes"() RETURNS "text"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_codes text[] := ARRAY[]::text[];
  v_code text;
  i integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Replace any previously generated unused codes
  DELETE FROM public.mfa_backup_codes
   WHERE user_id = v_user_id
     AND used_at IS NULL;

  -- Generate 10 codes of the form XXXX-XXXX (8 hex chars, dashed)
  FOR i IN 1..10 LOOP
    v_code := upper(
      substr(encode(gen_random_bytes(2), 'hex'), 1, 4) || '-' ||
      substr(encode(gen_random_bytes(2), 'hex'), 1, 4)
    );
    INSERT INTO public.mfa_backup_codes (user_id, code_hash)
    VALUES (v_user_id, encode(digest(v_code || v_user_id::text, 'sha256'), 'hex'));
    v_codes := v_codes || v_code;
  END LOOP;

  RETURN v_codes;
END;
$$;


ALTER FUNCTION "public"."mfa_generate_backup_codes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mfa_unused_backup_code_count"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COUNT(*)::integer
  FROM public.mfa_backup_codes
  WHERE user_id = auth.uid() AND used_at IS NULL;
$$;


ALTER FUNCTION "public"."mfa_unused_backup_code_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where id = auth.uid();
$$;


ALTER FUNCTION "public"."my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notification_link_booking_id"("p_link" "text") RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  SELECT CASE
    WHEN p_link ~ '/my-shifts/confirm/[0-9a-f-]{36}$'
      THEN substring(p_link from '([0-9a-f-]{36})$')::uuid
    WHEN p_link ~ '/my-shifts/[0-9a-f-]{36}$'
      THEN substring(p_link from '([0-9a-f-]{36})$')::uuid
    ELSE NULL
  END;
$_$;


ALTER FUNCTION "public"."notification_link_booking_id"("p_link" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_email_on_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  profile_rec record;
  payload jsonb;
  supabase_url text := 'https://esycmohgumryeqteiwla.supabase.co';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeWNtb2hndW1yeWVxdGVpd2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTYyMDksImV4cCI6MjA5MDMzMjIwOX0.Qa6683q4MwKzWEMGgEB-fQG8jiSJw3xoZp4b6GyaAf8';
BEGIN
  SELECT email, full_name, notif_email
    INTO profile_rec
    FROM public.profiles
    WHERE id = NEW.user_id;

  IF profile_rec.notif_email IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'record', jsonb_build_object(
      'id',      NEW.id,
      'user_id', NEW.user_id,
      'type',    NEW.type,
      'title',   NEW.title,
      'message', NEW.message,
      'link',    NEW.link,
      'data',    NEW.data
    )
  );

  -- Never let webhook failures roll back the surrounding transaction.
  BEGIN
    PERFORM net.http_post(
      url     := supabase_url || '/functions/v1/notification-webhook',
      body    := payload,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || anon_key
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log but don't propagate
    RAISE WARNING 'notify_email_on_notification webhook failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_email_on_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_overlapping_bookings"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  new_start time;
  new_end   time;
  new_date  date;
  overlap_count int;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.booking_status = NEW.booking_status THEN RETURN NEW; END IF;
  IF NEW.booking_status NOT IN ('confirmed', 'waitlisted') THEN RETURN NEW; END IF;
  SELECT s.shift_date INTO new_date FROM public.shifts s WHERE s.id = NEW.shift_id;
  IF NEW.time_slot_id IS NOT NULL THEN
    SELECT sts.slot_start, sts.slot_end INTO new_start, new_end FROM public.shift_time_slots sts WHERE sts.id = NEW.time_slot_id;
  ELSE
    SELECT s.start_time, s.end_time INTO new_start, new_end FROM public.shifts s WHERE s.id = NEW.shift_id;
  END IF;
  IF new_start IS NULL OR new_end IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO overlap_count
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  LEFT JOIN public.shift_time_slots sts ON sts.id = sb.time_slot_id
  WHERE sb.volunteer_id = NEW.volunteer_id
    AND sb.booking_status IN ('confirmed', 'waitlisted')
    AND sb.id != NEW.id
    AND s.shift_date = new_date
    AND COALESCE(sts.slot_start, s.start_time) < new_end
    AND COALESCE(sts.slot_end, s.end_time) > new_start;
  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'You already have a booking that overlaps with this shift time.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_overlapping_bookings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_role_self_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Skip check during admin transfer
  if current_setting('app.skip_self_escalation_check', true) = 'true' then
    return new;
  end if;
  if new.id = auth.uid() and new.role != old.role then
    raise exception 'You cannot change your own role.';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_role_self_escalation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_confirmation_reminders"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rec record;
  days_since int;
  reminder_count int;
begin
  for rec in
    select
      sb.id          as booking_id,
      sb.volunteer_id,
      sb.shift_id,
      s.shift_date,
      s.department_id,
      (current_date - s.shift_date) as days_since_shift
    from public.shift_bookings sb
    join public.shifts s on s.id = sb.shift_id
    where sb.booking_status    = 'confirmed'
      and sb.confirmation_status = 'pending_confirmation'
      and s.shift_date < current_date              -- shift has passed
      and (current_date - s.shift_date) <= 3       -- within escalation window
  loop
    days_since := rec.days_since_shift;

    select count(*) into reminder_count
    from public.confirmation_reminders
    where booking_id = rec.booking_id
      and recipient_type = 'coordinator';

    -- Days 1–2: remind coordinator (max 2 reminders)
    if days_since <= 2 and reminder_count < days_since then
      insert into public.confirmation_reminders
        (booking_id, recipient_type, recipient_id, reminder_number)
      select
        rec.booking_id,
        'coordinator',
        dc.coordinator_id,
        reminder_count + 1
      from public.department_coordinators dc
      where dc.department_id = rec.department_id;
    end if;

    -- Day 3: escalate to admins (if still unconfirmed)
    if days_since = 3 and not exists (
      select 1 from public.confirmation_reminders
      where booking_id = rec.booking_id and recipient_type = 'admin'
    ) then
      insert into public.confirmation_reminders
        (booking_id, recipient_type, recipient_id, reminder_number)
      select rec.booking_id, 'admin', p.id, 1
      from public.profiles p
      where p.role = 'admin';
    end if;

  end loop;
end;
$$;


ALTER FUNCTION "public"."process_confirmation_reminders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_booking_id    uuid;
  v_volunteer_id  uuid;
  v_shift_title   text;
  v_shift_date    date;
  v_shift_status  text;
  v_shift_end     timestamptz;
  v_shift_start   timestamptz;
  v_expires_at    timestamptz;
  v_window_minutes int;
  v_window_label  text;
BEGIN
  -- Fetch shift metadata.
  SELECT s.title, s.shift_date, s.status::text,
         public.shift_end_at(s.shift_date, s.end_time, s.time_type::text),
         public.shift_start_at(s.shift_date, s.start_time, s.time_type::text)
    INTO v_shift_title, v_shift_date, v_shift_status, v_shift_end, v_shift_start
    FROM public.shifts s
    WHERE s.id = p_shift_id;

  -- Basic guards.
  IF v_shift_title IS NULL THEN
    RETURN NULL; -- shift deleted
  END IF;
  IF v_shift_status = 'cancelled' THEN
    RETURN NULL;
  END IF;
  IF v_shift_end <= now() THEN
    RETURN NULL; -- shift already ended
  END IF;

  -- If the shift starts within 30 minutes, skip promotion entirely.
  -- Not enough time for the volunteer to see the offer and show up.
  IF v_shift_start <= now() + interval '30 minutes' THEN
    RETURN NULL;
  END IF;

  -- Find the next eligible waitlisted volunteer.
  SELECT sb.id, sb.volunteer_id
    INTO v_booking_id, v_volunteer_id
    FROM public.shift_bookings sb
    WHERE sb.shift_id = p_shift_id
      AND sb.booking_status = 'waitlisted'
      AND (sb.waitlist_offer_expires_at IS NULL
           OR sb.waitlist_offer_expires_at < now())
    ORDER BY sb.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

  IF v_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Dynamic expiry: the sooner of 2 hours or 30 minutes before start.
  v_expires_at := LEAST(
    now() + interval '2 hours',
    v_shift_start - interval '30 minutes'
  );

  -- Compute a human-readable window label for the notification.
  v_window_minutes := GREATEST(1, EXTRACT(EPOCH FROM (v_expires_at - now()))::int / 60);
  IF v_window_minutes >= 120 THEN
    v_window_label := '2 hours';
  ELSIF v_window_minutes >= 60 THEN
    v_window_label := '1 hour ' || (v_window_minutes - 60) || ' minutes';
  ELSE
    v_window_label := v_window_minutes || ' minutes';
  END IF;

  -- Set the offer.
  UPDATE public.shift_bookings
  SET waitlist_offer_expires_at = v_expires_at,
      updated_at = now()
  WHERE id = v_booking_id;

  -- Notify the volunteer.
  INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
  VALUES (
    v_volunteer_id,
    'waitlist_offer',
    'A spot just opened: ' || v_shift_title,
    'You have ' || v_window_label || ' to confirm or decline this shift. ' ||
      'The offer expires at ' ||
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM Mon DD') || '.',
    jsonb_build_object(
      'booking_id',    v_booking_id,
      'shift_id',      p_shift_id,
      'shift_title',   v_shift_title,
      'shift_date',    v_shift_date,
      'expires_at',    v_expires_at,
      'window_minutes', v_window_minutes,
      'shift_start',   v_shift_start
    ),
    '/dashboard',
    false
  );

  RETURN v_booking_id;
END;
$$;


ALTER FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid", "p_time_slot_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_booking_id uuid;
  v_volunteer_id uuid;
  v_shift_title text;
  v_shift_date date;
  v_shift_start_time time;
  v_shift_end_time time;
  v_shift_time_type text;
  v_slot_start time;
  v_slot_end time;
  v_expires_at timestamptz;
  v_shift_start timestamptz;
  v_window_minutes int;
  v_msg text;
BEGIN
  SELECT title, shift_date, start_time, end_time, time_type::text
    INTO v_shift_title, v_shift_date, v_shift_start_time, v_shift_end_time, v_shift_time_type
    FROM public.shifts WHERE id = p_shift_id;
  IF v_shift_title IS NULL THEN RETURN NULL; END IF;

  IF p_time_slot_id IS NOT NULL THEN
    SELECT slot_start, slot_end INTO v_slot_start, v_slot_end
      FROM public.shift_time_slots WHERE id = p_time_slot_id;
    SELECT sb.id, sb.volunteer_id INTO v_booking_id, v_volunteer_id
      FROM public.shift_bookings sb
      WHERE sb.shift_id = p_shift_id
        AND sb.time_slot_id = p_time_slot_id
        AND sb.booking_status = 'waitlisted'
        AND (sb.waitlist_offer_expires_at IS NULL OR sb.waitlist_offer_expires_at < now())
      ORDER BY sb.created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  ELSE
    SELECT sb.id, sb.volunteer_id INTO v_booking_id, v_volunteer_id
      FROM public.shift_bookings sb
      WHERE sb.shift_id = p_shift_id
        AND sb.booking_status = 'waitlisted'
        AND sb.time_slot_id IS NULL
        AND (sb.waitlist_offer_expires_at IS NULL OR sb.waitlist_offer_expires_at < now())
      ORDER BY sb.created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  END IF;
  IF v_booking_id IS NULL THEN RETURN NULL; END IF;

  v_shift_start := public.shift_start_at(v_shift_date, v_shift_start_time, v_shift_time_type);
  IF v_shift_start <= now() + interval '30 minutes' THEN RETURN NULL; END IF;
  v_window_minutes := EXTRACT(EPOCH FROM (v_shift_start - now()))::int / 60;
  IF v_window_minutes <= 120 THEN
    v_expires_at := v_shift_start - interval '30 minutes';
  ELSE
    v_expires_at := now() + interval '2 hours';
  END IF;

  UPDATE public.shift_bookings SET waitlist_offer_expires_at = v_expires_at, updated_at = now() WHERE id = v_booking_id;

  IF p_time_slot_id IS NOT NULL AND v_slot_start IS NOT NULL THEN
    v_msg := format('A spot opened for %s on %s (%s - %s). You have until %s to accept.',
      v_shift_title, to_char(v_shift_date, 'Mon DD'),
      to_char(v_slot_start, 'HH12:MI AM'), to_char(v_slot_end, 'HH12:MI AM'),
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM'));
  ELSE
    v_msg := format('A spot opened for %s on %s. You have until %s to accept.',
      v_shift_title, to_char(v_shift_date, 'Mon DD'),
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM'));
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
  VALUES (v_volunteer_id, 'waitlist_offer', 'A spot just opened: ' || v_shift_title, v_msg,
    jsonb_build_object('booking_id', v_booking_id, 'shift_id', p_shift_id,
      'shift_title', v_shift_title, 'shift_date', v_shift_date, 'expires_at', v_expires_at,
      'time_slot_id', p_time_slot_id, 'slot_start', v_slot_start, 'slot_end', v_slot_end),
    '/dashboard', false);
  RETURN v_booking_id;
END;
$$;


ALTER FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid", "p_time_slot_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_consistency"("p_volunteer_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  attended   int;
  total      int;
  score      numeric(5,2);
  extended   boolean;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE confirmation_status = 'confirmed'),
    COUNT(*)
  INTO attended, total
  FROM (
    SELECT confirmation_status
    FROM public.shift_bookings b
    JOIN public.shifts s ON s.id = b.shift_id
    WHERE b.volunteer_id = p_volunteer_id
      AND b.booking_status = 'confirmed'
      AND b.confirmation_status IN ('confirmed', 'no_show')
      AND s.shift_date <= current_date
    ORDER BY s.shift_date DESC
    LIMIT 5
  ) recent;

  -- Don't compute a score until the volunteer has at least 5
  -- completed shifts. NULL signals "not enough data" to the UI.
  IF total < 5 THEN
    score    := NULL;
    extended := false;
  ELSE
    score    := ROUND((attended::numeric / total) * 100, 2);
    extended := score >= 90;
  END IF;

  UPDATE public.profiles
  SET consistency_score = score,
      extended_booking  = extended,
      updated_at        = now()
  WHERE id = p_volunteer_id;
END;
$$;


ALTER FUNCTION "public"."recalculate_consistency"("p_volunteer_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recalculate_consistency"("p_volunteer_id" "uuid") IS 'Calculates consistency score over the last 5 completed shifts only.
   The subquery uses ORDER BY shift_date DESC LIMIT 5 intentionally —
   this is a rolling window calculation, not a lifetime average.
   Do not remove the LIMIT without updating the business logic.';



CREATE OR REPLACE FUNCTION "public"."recalculate_points"("volunteer_uuid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  pts integer := 0;
  shift_pts integer := 0;
  rating_pts integer := 0;
  milestone_pts integer := 0;
BEGIN
  SELECT COALESCE(SUM(COALESCE(final_hours, 0)) * 10, 0)::integer INTO shift_pts
  FROM shift_bookings
  WHERE volunteer_id = volunteer_uuid
    AND booking_status = 'confirmed'
    AND confirmation_status = 'confirmed';
  SELECT COALESCE(COUNT(*) * 5, 0)::integer INTO rating_pts
  FROM volunteer_shift_reports vsr
  JOIN shift_bookings sb ON vsr.booking_id = sb.id
  WHERE sb.volunteer_id = volunteer_uuid AND vsr.star_rating = 5;
  SELECT COALESCE(floor(total_hours / 10) * 25, 0)::integer INTO milestone_pts
  FROM profiles WHERE id = volunteer_uuid;
  pts := shift_pts + rating_pts + milestone_pts;
  UPDATE profiles SET volunteer_points = pts WHERE id = volunteer_uuid;
END;
$$;


ALTER FUNCTION "public"."recalculate_points"("volunteer_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_shift_counters"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.shifts s SET booked_slots = sub.cnt
  FROM (SELECT shift_id, COUNT(*) AS cnt FROM public.shift_bookings WHERE booking_status = 'confirmed' GROUP BY shift_id) sub
  WHERE s.id = sub.shift_id AND s.booked_slots IS DISTINCT FROM sub.cnt;

  UPDATE public.shifts s SET booked_slots = 0
  WHERE s.booked_slots > 0 AND NOT EXISTS (
    SELECT 1 FROM public.shift_bookings sb WHERE sb.shift_id = s.id AND sb.booking_status = 'confirmed');

  UPDATE public.shift_time_slots sts SET booked_slots = LEAST(counts.cnt, sts.total_slots)
  FROM (
    SELECT slot_id, SUM(cnt) AS cnt FROM (
      SELECT time_slot_id AS slot_id, COUNT(*) AS cnt FROM public.shift_bookings
      WHERE time_slot_id IS NOT NULL AND booking_status = 'confirmed' GROUP BY time_slot_id
      UNION ALL
      SELECT sbs.slot_id, COUNT(*) AS cnt FROM public.shift_booking_slots sbs
      JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
      WHERE sb.booking_status = 'confirmed' AND sb.time_slot_id IS NULL GROUP BY sbs.slot_id
    ) combined GROUP BY slot_id
  ) counts
  WHERE sts.id = counts.slot_id AND sts.booked_slots IS DISTINCT FROM LEAST(counts.cnt, sts.total_slots);

  UPDATE public.shift_time_slots sts SET booked_slots = 0
  WHERE sts.booked_slots > 0
    AND NOT EXISTS (SELECT 1 FROM public.shift_bookings sb WHERE sb.time_slot_id = sts.id AND sb.booking_status = 'confirmed')
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_booking_slots sbs JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
      WHERE sbs.slot_id = sts.id AND sb.booking_status = 'confirmed' AND sb.time_slot_id IS NULL);
END;
$$;


ALTER FUNCTION "public"."reconcile_shift_counters"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_hours_discrepancy"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_hours  numeric(5,2);
  c_hours  numeric(5,2);
  diff     numeric(5,2);
  final    numeric(5,2);
  source   text;
  vol_id   uuid;
begin
  select sb.volunteer_reported_hours,
         sb.coordinator_reported_hours,
         sb.volunteer_id
  into v_hours, c_hours, vol_id
  from public.shift_bookings sb
  where sb.id = p_booking_id;

  -- If only one party has reported hours, use what we have
  if v_hours is null and c_hours is not null then
    final := c_hours; source := 'coordinator';
  elsif c_hours is null and v_hours is not null then
    final := v_hours; source := 'volunteer';
  elsif v_hours is not null and c_hours is not null then
    diff := abs(v_hours - c_hours);
    if diff > 2 then
      final := c_hours; source := 'coordinator';
    else
      final := v_hours; source := 'volunteer';
    end if;
  else
    return; -- Neither has reported yet
  end if;

  -- Record final hours on the booking
  update public.shift_bookings
  set final_hours  = final,
      hours_source = source,
      updated_at   = now()
  where id = p_booking_id;

  -- Update volunteer total_hours
  update public.profiles
  set total_hours = (
    select coalesce(sum(final_hours), 0)
    from public.shift_bookings
    where volunteer_id = vol_id
      and confirmation_status = 'confirmed'
      and final_hours is not null
  ),
  updated_at = now()
  where id = vol_id;
end;
$$;


ALTER FUNCTION "public"."resolve_hours_discrepancy"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_shifts_for_volunteer"("p_volunteer_id" "uuid", "p_max_days" integer DEFAULT 14) RETURNS TABLE("shift_id" "uuid", "title" "text", "shift_date" "date", "department_id" "uuid", "department_name" "text", "start_time" time without time zone, "end_time" time without time zone, "time_type" "text", "total_slots" integer, "booked_slots" integer, "requires_bg_check" boolean, "fill_ratio" numeric, "preference_match" numeric, "organizational_need" numeric, "novelty_bonus" numeric, "total_score" numeric, "score_breakdown" "jsonb")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_prefs record;
  v_max_interactions numeric;
BEGIN
  SELECT * INTO v_prefs FROM public.volunteer_preferences WHERE volunteer_id = p_volunteer_id;

  SELECT LEAST(COALESCE(MAX(cnt), 1), 50)::numeric INTO v_max_interactions
  FROM (SELECT COUNT(*) as cnt FROM public.volunteer_shift_interactions WHERE volunteer_id = p_volunteer_id GROUP BY volunteer_shift_interactions.shift_id) sub;

  RETURN QUERY
  WITH si AS (
    SELECT vsi.shift_id AS si_shift_id, COUNT(*)::numeric as interaction_count
    FROM public.volunteer_shift_interactions vsi WHERE vsi.volunteer_id = p_volunteer_id GROUP BY vsi.shift_id
  ),
  avail AS (
    SELECT
      s.id AS s_id, s.title AS s_title, s.shift_date AS s_date, s.department_id AS s_dept,
      d.name AS d_name, s.start_time AS s_start, s.end_time AS s_end, s.time_type::text AS s_time_type,
      s.total_slots AS s_total, s.booked_slots AS s_booked, s.requires_bg_check AS s_bg,
      COALESCE(si.interaction_count, 0::numeric) AS interactions
    FROM public.shifts s
    JOIN public.departments d ON d.id = s.department_id
    LEFT JOIN si ON si.si_shift_id = s.id
    WHERE s.status = 'open'
      AND s.shift_date >= CURRENT_DATE
      AND s.shift_date <= CURRENT_DATE + (p_max_days || ' days')::interval
      AND s.booked_slots < s.total_slots
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_bookings sb
        WHERE sb.shift_id = s.id AND sb.volunteer_id = p_volunteer_id AND sb.booking_status = 'confirmed'
      )
  )
  SELECT
    a.s_id, a.s_title, a.s_date, a.s_dept, a.d_name, a.s_start, a.s_end, a.s_time_type,
    a.s_total, a.s_booked, a.s_bg,
    CASE WHEN a.s_total > 0 THEN (a.s_booked::numeric / a.s_total::numeric) ELSE 0::numeric END,
    COALESCE((v_prefs.department_affinity->>(a.s_dept::text))::numeric / 100.0, 0.5::numeric),
    CASE WHEN a.s_total > 0 THEN (1.0 - (a.s_booked::numeric / a.s_total::numeric))::numeric ELSE 0.5::numeric END,
    GREATEST(1.0::numeric - (ln(1.0 + a.interactions)::numeric / ln(1.0 + v_max_interactions)::numeric), 0.3::numeric),
    (
      COALESCE((v_prefs.department_affinity->>(a.s_dept::text))::numeric / 100.0, 0.5::numeric) * 0.5
      + (CASE WHEN a.s_total > 0 THEN (1.0 - (a.s_booked::numeric / a.s_total::numeric))::numeric ELSE 0.5::numeric END) * 0.3
      + GREATEST(1.0::numeric - (ln(1.0 + a.interactions)::numeric / ln(1.0 + v_max_interactions)::numeric), 0.3::numeric) * 0.2
    )::numeric,
    jsonb_build_object(
      'has_history', (SELECT COUNT(*) > 0 FROM public.volunteer_shift_interactions WHERE volunteer_id = p_volunteer_id),
      'preference_weight', 0.5, 'org_need_weight', 0.3, 'novelty_weight', 0.2,
      'interactions', a.interactions, 'novelty_floor', 0.3
    )
  FROM avail a
  ORDER BY 16 DESC
  LIMIT 20;
END;
$$;


ALTER FUNCTION "public"."score_shifts_for_volunteer"("p_volunteer_id" "uuid", "p_max_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_self_confirmation_reminders"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  rec record;
begin
  for rec in
    select 
      sb.id          as booking_id,
      sb.volunteer_id,
      s.title        as shift_title,
      s.shift_date,
      s.end_time,
      p.full_name    as volunteer_name
    from public.shift_bookings sb
    join public.shifts s on s.id = sb.shift_id
    join public.profiles p on p.id = sb.volunteer_id
    left join public.volunteer_shift_reports vsr on vsr.booking_id = sb.id
    where sb.booking_status = 'confirmed'
      and sb.confirmation_status = 'confirmed'
      and s.shift_date <= current_date
      -- Shift has ended (end_time passed or all-day shift date has passed)
      and (
        s.end_time is null
        or (s.shift_date = current_date and s.end_time <= current_time - interval '2 hours')
        or s.shift_date < current_date
      )
      -- No self-confirmation report submitted yet
      and (vsr.id is null or vsr.self_confirm_status = 'pending')
      -- Reminder not already sent in last 24 hours
      and (vsr.reminder_sent_at is null 
           or vsr.reminder_sent_at < now() - interval '24 hours')
      -- Within 48-hour window
      and s.shift_date >= current_date - interval '48 hours'
  loop
    -- Insert or update the report record
    insert into public.volunteer_shift_reports 
      (booking_id, volunteer_id, self_confirm_status, reminder_sent_at)
    values (rec.booking_id, rec.volunteer_id, 'pending', now())
    on conflict (booking_id) 
    do update set reminder_sent_at = now();

    -- Create in-app notification
    insert into public.notifications 
      (user_id, type, title, message, link)
    values (
      rec.volunteer_id,
      'self_confirmation_reminder',
      'Please confirm your shift attendance',
      'Your shift "' || rec.shift_title || '" on ' || 
        to_char(rec.shift_date, 'Mon DD, YYYY') || 
        ' has ended. Please confirm attendance, log your hours, and rate the shift.',
      '/my-shifts/confirm/' || rec.booking_id
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."send_self_confirmation_reminders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin new.updated_at = now(); return new; end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shift_end_at"("p_shift_date" "date", "p_end_time" time without time zone, "p_time_type" "text") RETURNS timestamp with time zone
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT (
    (p_shift_date::text || ' ' || COALESCE(
      p_end_time::text,
      CASE p_time_type
        WHEN 'morning'   THEN '12:00:00'
        WHEN 'afternoon' THEN '16:00:00'
        WHEN 'all_day'   THEN '17:00:00'
        ELSE '17:00:00'
      END
    ))::timestamp AT TIME ZONE 'America/Chicago'
  );
$$;


ALTER FUNCTION "public"."shift_end_at"("p_shift_date" "date", "p_end_time" time without time zone, "p_time_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."shift_start_at"("p_shift_date" "date", "p_start_time" time without time zone, "p_time_type" "text") RETURNS timestamp with time zone
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT (
    (p_shift_date::text || ' ' || COALESCE(
      p_start_time::text,
      CASE p_time_type
        WHEN 'morning'   THEN '09:00:00'
        WHEN 'afternoon' THEN '13:00:00'
        WHEN 'all_day'   THEN '09:00:00'
        ELSE '09:00:00'
      END
    ))::timestamp AT TIME ZONE 'America/Chicago'
  );
$$;


ALTER FUNCTION "public"."shift_start_at"("p_shift_date" "date", "p_start_time" time without time zone, "p_time_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_booked_slots"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_slot_id uuid;
  v_shift_id uuid;
BEGIN
  v_shift_id := COALESCE(NEW.shift_id, OLD.shift_id);
  v_slot_id  := COALESCE(NEW.time_slot_id, OLD.time_slot_id);
  IF v_slot_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shift_time_slots SET booked_slots = LEAST(booked_slots + 1, total_slots) WHERE id = v_slot_id;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.booking_status = 'confirmed' AND NEW.booking_status IN ('cancelled', 'waitlisted') THEN
        UPDATE public.shift_time_slots SET booked_slots = GREATEST(booked_slots - 1, 0) WHERE id = v_slot_id;
      ELSIF OLD.booking_status IN ('waitlisted', 'cancelled') AND NEW.booking_status = 'confirmed' THEN
        UPDATE public.shift_time_slots SET booked_slots = LEAST(booked_slots + 1, total_slots) WHERE id = v_slot_id;
      END IF;
    END IF;
  ELSE
    IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shifts SET booked_slots = booked_slots + 1 WHERE id = v_shift_id;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.booking_status = 'confirmed' AND NEW.booking_status IN ('cancelled', 'waitlisted') THEN
        UPDATE public.shifts SET booked_slots = GREATEST(booked_slots - 1, 0) WHERE id = v_shift_id;
      ELSIF OLD.booking_status IN ('waitlisted', 'cancelled') AND NEW.booking_status = 'confirmed' THEN
        UPDATE public.shifts SET booked_slots = booked_slots + 1 WHERE id = v_shift_id;
      END IF;
    END IF;
  END IF;
  UPDATE public.shifts SET booked_slots = (
    SELECT COUNT(*) FROM public.shift_bookings WHERE shift_id = v_shift_id AND booking_status = 'confirmed'
  ) WHERE id = v_shift_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_booked_slots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_is_minor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.is_minor := (
    NEW.date_of_birth IS NOT NULL
    AND age(NEW.date_of_birth) < interval '18 years'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_is_minor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_slot_booked_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total integer;
  v_current integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT total_slots, booked_slots INTO v_total, v_current
      FROM public.shift_time_slots
      WHERE id = NEW.slot_id
      FOR UPDATE;
    UPDATE public.shift_time_slots
      SET booked_slots = LEAST(v_current + 1, v_total)
      WHERE id = NEW.slot_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.shift_time_slots
      SET booked_slots = GREATEST(booked_slots - 1, 0)
      WHERE id = OLD.slot_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_slot_booked_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_volunteer_reported_hours"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  -- When volunteer submits self-confirmation with hours,
  -- sync to shift_bookings for the discrepancy resolution function
  if new.self_reported_hours is not null then
    update public.shift_bookings
    set volunteer_reported_hours = new.self_reported_hours,
        updated_at = now()
    where id = new.booking_id;
    -- Immediately attempt discrepancy resolution
    perform public.resolve_hours_discrepancy(new.booking_id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_volunteer_reported_hours"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_admin_role"("from_admin_id" "uuid", "to_coordinator_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare target_role public.user_role;
begin
  if (select role from public.profiles where id = from_admin_id) != 'admin' then
    raise exception 'Source user is not an admin.';
  end if;
  select role into target_role from public.profiles where id = to_coordinator_id;
  if target_role != 'coordinator' then
    raise exception 'Admin role can only be transferred to a coordinator.';
  end if;
  -- Set session flag to bypass self-escalation check during transfer
  perform set_config('app.skip_self_escalation_check', 'true', true);
  update public.profiles set role = 'coordinator', updated_at = now() where id = from_admin_id;
  update public.profiles set role = 'admin',       updated_at = now() where id = to_coordinator_id;
  perform set_config('app.skip_self_escalation_check', 'false', true);
end;
$$;


ALTER FUNCTION "public"."transfer_admin_role"("from_admin_id" "uuid", "to_coordinator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_coordinator_and_delete"("p_coordinator_id" "uuid", "p_admin_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_coord_role       text;
  v_coord_name       text;
  v_admin_role       text;
  v_dept             record;
  v_other_coord_id   uuid;
  v_depts_transferred int := 0;
  v_depts_removed     int := 0;
  v_shifts_transferred int := 0;
  v_notifs_deleted    int := 0;
  v_step              text := 'validation';
BEGIN
  -- ────────────────────────────────────────────────────────
  -- 0. Validate inputs
  -- ────────────────────────────────────────────────────────
  SELECT role, full_name INTO v_coord_role, v_coord_name
    FROM public.profiles WHERE id = p_coordinator_id;

  IF v_coord_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Coordinator profile not found.');
  END IF;

  IF v_coord_role != 'coordinator' THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Target user is not a coordinator (role: ' || v_coord_role || ').');
  END IF;

  SELECT role INTO v_admin_role
    FROM public.profiles WHERE id = p_admin_id;

  IF v_admin_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Performing user is not an admin.');
  END IF;

  IF p_coordinator_id = p_admin_id THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Cannot delete yourself.');
  END IF;

  -- ────────────────────────────────────────────────────────
  -- 1. Department ownership transfer
  -- ────────────────────────────────────────────────────────
  v_step := 'department_transfer';

  FOR v_dept IN
    SELECT dc.department_id
      FROM public.department_coordinators dc
     WHERE dc.coordinator_id = p_coordinator_id
  LOOP
    -- Is there another coordinator for this department?
    SELECT dc.coordinator_id INTO v_other_coord_id
      FROM public.department_coordinators dc
     WHERE dc.department_id = v_dept.department_id
       AND dc.coordinator_id != p_coordinator_id
     LIMIT 1;

    IF v_other_coord_id IS NULL THEN
      -- No other coordinator → assign admin as interim
      INSERT INTO public.department_coordinators (coordinator_id, department_id)
      VALUES (p_admin_id, v_dept.department_id)
      ON CONFLICT (coordinator_id, department_id) DO NOTHING;
      v_depts_transferred := v_depts_transferred + 1;
    ELSE
      -- Another coordinator exists → just remove this one (no orphan)
      v_depts_removed := v_depts_removed + 1;
    END IF;
  END LOOP;

  -- Remove the coordinator from all departments explicitly
  -- (CASCADE would do this, but being explicit keeps the ordering clear)
  DELETE FROM public.department_coordinators
   WHERE coordinator_id = p_coordinator_id;

  -- ────────────────────────────────────────────────────────
  -- 2. Shift ownership transfer
  -- ────────────────────────────────────────────────────────
  v_step := 'shift_transfer';

  UPDATE public.shifts s
     SET created_by  = COALESCE(
           -- Prefer another coordinator already assigned to the department
           (SELECT dc.coordinator_id
              FROM public.department_coordinators dc
             WHERE dc.department_id = s.department_id
               AND dc.coordinator_id != p_coordinator_id
             LIMIT 1),
           -- Fallback: the admin performing the delete
           p_admin_id
         ),
         updated_at = now()
   WHERE s.created_by = p_coordinator_id;

  GET DIAGNOSTICS v_shifts_transferred = ROW_COUNT;

  -- ────────────────────────────────────────────────────────
  -- 3. Reassign / nullify all remaining NO-ACTION FKs
  --    so the profile row can be deleted without constraint
  --    violations. Bookings (volunteer rows) are NOT touched.
  -- ────────────────────────────────────────────────────────
  v_step := 'reassign_references';

  -- shift_bookings: coordinator-side columns
  UPDATE public.shift_bookings
     SET coordinator_actioned_by = p_admin_id
   WHERE coordinator_actioned_by = p_coordinator_id;

  UPDATE public.shift_bookings
     SET confirmed_by = p_admin_id
   WHERE confirmed_by = p_coordinator_id;

  -- attendance_disputes
  UPDATE public.attendance_disputes
     SET coordinator_id = p_admin_id
   WHERE coordinator_id = p_coordinator_id;

  -- shift_notes (audit trail — reassign so history is preserved)
  UPDATE public.shift_notes
     SET author_id = p_admin_id
   WHERE author_id = p_coordinator_id;

  -- shift_invitations
  UPDATE public.shift_invitations
     SET invited_by = p_admin_id
   WHERE invited_by = p_coordinator_id;

  -- shift_attachments
  UPDATE public.shift_attachments
     SET uploader_id = p_admin_id
   WHERE uploader_id = p_coordinator_id;

  -- shift_recurrence_rules
  UPDATE public.shift_recurrence_rules
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  -- conversations & messages
  UPDATE public.conversations
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  UPDATE public.messages
     SET sender_id = p_admin_id
   WHERE sender_id = p_coordinator_id;

  -- confirmation_reminders (transient — just delete)
  DELETE FROM public.confirmation_reminders
   WHERE recipient_id = p_coordinator_id;

  -- admin_action_log (audit)
  UPDATE public.admin_action_log
     SET admin_id = p_admin_id
   WHERE admin_id = p_coordinator_id;

  -- private_note_access_log
  UPDATE public.private_note_access_log
     SET admin_user_id = p_admin_id
   WHERE admin_user_id = p_coordinator_id;

  -- document_types
  UPDATE public.document_types
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  -- events & event_registrations
  UPDATE public.events
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  DELETE FROM public.event_registrations
   WHERE volunteer_id = p_coordinator_id;

  -- volunteer_shift_reports (coordinator may have self-reported)
  DELETE FROM public.volunteer_shift_reports
   WHERE volunteer_id = p_coordinator_id;

  -- department_restrictions
  UPDATE public.department_restrictions
     SET restricted_by = p_admin_id
   WHERE restricted_by = p_coordinator_id;

  -- shift_bookings where coordinator was also a volunteer
  -- (cancel their own bookings — these are not "other volunteers' bookings")
  DELETE FROM public.shift_bookings
   WHERE volunteer_id = p_coordinator_id;

  -- ────────────────────────────────────────────────────────
  -- 4. Notification cleanup
  --    Delete undelivered (unread) notifications for this
  --    coordinator. Read notifications and notifications
  --    addressed to volunteers are left untouched.
  -- ────────────────────────────────────────────────────────
  v_step := 'notification_cleanup';

  DELETE FROM public.notifications
   WHERE user_id = p_coordinator_id
     AND is_read = false;

  GET DIAGNOSTICS v_notifs_deleted = ROW_COUNT;

  -- ────────────────────────────────────────────────────────
  -- 5. Delete the profile
  --    Remaining CASCADE FKs (notifications read, mfa_backup_codes,
  --    volunteer_documents, conversation_participants, etc.)
  --    are cleaned up automatically by the cascade.
  -- ────────────────────────────────────────────────────────
  v_step := 'delete_profile';

  DELETE FROM public.profiles WHERE id = p_coordinator_id;

  RETURN jsonb_build_object(
    'success',                true,
    'coordinator_name',       v_coord_name,
    'departments_transferred', v_depts_transferred,
    'departments_removed',     v_depts_removed,
    'shifts_transferred',      v_shifts_transferred,
    'notifications_deleted',   v_notifs_deleted
  );

EXCEPTION WHEN OTHERS THEN
  -- Any failure → whole transaction rolls back automatically
  RETURN jsonb_build_object(
    'success', false,
    'step',    v_step,
    'error',   SQLERRM
  );
END;
$$;


ALTER FUNCTION "public"."transfer_coordinator_and_delete"("p_coordinator_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalc_consistency_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.recalculate_consistency(new.volunteer_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_recalc_consistency_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalculate_consistency_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_consistency(OLD.volunteer_id);
    RETURN OLD;
  ELSE
    PERFORM recalculate_consistency(NEW.volunteer_id);
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."trg_recalculate_consistency_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_recalculate_points_fn"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_points(OLD.volunteer_id);
    RETURN OLD;
  ELSE
    PERFORM recalculate_points(NEW.volunteer_id);
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."trg_recalculate_points_fn"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_update_preferences_on_interaction"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  perform public.update_volunteer_preferences(new.volunteer_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_update_preferences_on_interaction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_waitlist_promote_on_cancel"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.booking_status = 'confirmed' AND NEW.booking_status = 'cancelled' THEN
    PERFORM public.promote_next_waitlist(NEW.shift_id, NEW.time_slot_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_waitlist_promote_on_cancel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_waitlist_promote_on_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.booking_status = 'confirmed' THEN
    PERFORM public.promote_next_waitlist(OLD.shift_id, OLD.time_slot_id);
  END IF;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."trg_waitlist_promote_on_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_shift_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Never change status of cancelled or completed shifts
  if new.status in ('cancelled', 'completed') then return new; end if;
  if new.booked_slots >= new.total_slots then
    new.status = 'full';
  elsif new.status = 'full' and new.booked_slots < new.total_slots then
    new.status = 'open';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."update_shift_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_volunteer_preferences"("p_volunteer_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_day_affinity  jsonb := '{}';
  v_time_affinity jsonb := '{}';
  v_dept_affinity jsonb := '{}';
  v_alpha         float := 2;
  v_beta          float := 1;
  v_total         int := 0;
  v_avg_advance   float := 7;
  rec             record;
  day_key         text;
  time_key        text;
  dept_key        text;
  day_score       float;
  time_score      float;
  dept_score      float;
  iw              float;
begin
  select count(*) into v_total
  from public.volunteer_shift_interactions
  where volunteer_id = p_volunteer_id;

  select coalesce(avg(s.shift_date - i.created_at::date), 7)
  into v_avg_advance
  from public.volunteer_shift_interactions i
  join public.shifts s on s.id = i.shift_id
  where i.volunteer_id = p_volunteer_id
    and i.interaction_type = 'signed_up'
    and s.shift_date >= i.created_at::date;

  for rec in
    select i.interaction_type, s.shift_date,
           s.time_type, s.department_id,
           extract(dow from s.shift_date) as dow
    from public.volunteer_shift_interactions i
    join public.shifts s on s.id = i.shift_id
    where i.volunteer_id = p_volunteer_id
  loop
    iw := case rec.interaction_type
      when 'completed'  then  1.0
      when 'signed_up'  then  0.5
      when 'viewed'     then  0.1
      when 'cancelled'  then -0.3
      when 'no_show'    then -0.5
      else 0
    end;

    day_key := case rec.dow::int
      when 0 then 'sunday' when 1 then 'monday'
      when 2 then 'tuesday' when 3 then 'wednesday'
      when 4 then 'thursday' when 5 then 'friday'
      else 'saturday'
    end;
    day_score := coalesce((v_day_affinity->>day_key)::float, 0.5);
    day_score := greatest(0, least(1, day_score + (iw * 0.1)));
    v_day_affinity := v_day_affinity || jsonb_build_object(day_key, day_score);

    time_key := rec.time_type::text;
    time_score := coalesce((v_time_affinity->>time_key)::float, 0.5);
    time_score := greatest(0, least(1, time_score + (iw * 0.1)));
    v_time_affinity := v_time_affinity || jsonb_build_object(time_key, time_score);

    dept_key := rec.department_id::text;
    dept_score := coalesce((v_dept_affinity->>dept_key)::float, 0.5);
    dept_score := greatest(0, least(1, dept_score + (iw * 0.1)));
    v_dept_affinity := v_dept_affinity || jsonb_build_object(dept_key, dept_score);

    if rec.interaction_type = 'completed' then v_alpha := v_alpha + 1;
    elsif rec.interaction_type = 'no_show' then v_beta := v_beta + 1;
    elsif rec.interaction_type = 'cancelled' then v_beta := v_beta + 0.5;
    end if;
  end loop;

  insert into public.volunteer_preferences (
    volunteer_id, day_of_week_affinity, time_of_day_affinity,
    department_affinity, avg_advance_booking_days, total_interactions,
    reliability_alpha, reliability_beta, updated_at
  ) values (
    p_volunteer_id, v_day_affinity, v_time_affinity,
    v_dept_affinity, v_avg_advance, v_total,
    v_alpha, v_beta, now()
  )
  on conflict (volunteer_id) do update set
    day_of_week_affinity     = excluded.day_of_week_affinity,
    time_of_day_affinity     = excluded.time_of_day_affinity,
    department_affinity      = excluded.department_affinity,
    avg_advance_booking_days = excluded.avg_advance_booking_days,
    total_interactions       = excluded.total_interactions,
    reliability_alpha        = excluded.reliability_alpha,
    reliability_beta         = excluded.reliability_beta,
    updated_at               = now();
end;
$$;


ALTER FUNCTION "public"."update_volunteer_preferences"("p_volunteer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."username_available"("p_username" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RETURN false;
  END IF;

  -- Format check
  IF NOT (length(trim(p_username)) BETWEEN 3 AND 30
          AND trim(p_username) ~ '^[A-Za-z0-9_]+$') THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE username = trim(p_username)::citext
  );
END;
$_$;


ALTER FUNCTION "public"."username_available"("p_username" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_booking_slot_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  actual_booked integer;
  max_slots integer;
BEGIN
  IF NEW.time_slot_id IS NOT NULL THEN
    SELECT total_slots INTO max_slots
      FROM public.shift_time_slots WHERE id = NEW.time_slot_id FOR UPDATE;
    IF max_slots IS NULL THEN RETURN NEW; END IF;
    SELECT COUNT(*) INTO actual_booked
      FROM public.shift_bookings
      WHERE time_slot_id = NEW.time_slot_id
        AND booking_status = 'confirmed'
        AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF actual_booked >= max_slots THEN
      NEW.booking_status := 'waitlisted';
    END IF;
  ELSE
    SELECT total_slots INTO max_slots
      FROM public.shifts WHERE id = NEW.shift_id FOR UPDATE;
    IF max_slots IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM public.shift_time_slots WHERE shift_id = NEW.shift_id FOR UPDATE;
    SELECT COUNT(*) INTO actual_booked
      FROM public.shift_bookings
      WHERE shift_id = NEW.shift_id
        AND booking_status = 'confirmed'
        AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF actual_booked >= max_slots THEN
      NEW.booking_status := 'waitlisted';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_booking_slot_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_checkin_token"("p_token" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.checkin_tokens
     WHERE token = p_token
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > now())
  );
$$;


ALTER FUNCTION "public"."validate_checkin_token"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."waitlist_accept"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_offer_expires timestamptz;
  v_status booking_status;
  v_shift_end timestamptz;
  v_shift_status text;
BEGIN
  SELECT volunteer_id, shift_id, waitlist_offer_expires_at, booking_status
    INTO v_volunteer_id, v_shift_id, v_offer_expires, v_status
    FROM public.shift_bookings
    WHERE id = p_booking_id
    FOR UPDATE;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;
  IF v_volunteer_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your booking';
  END IF;
  IF v_status <> 'waitlisted' THEN
    RAISE EXCEPTION 'no active waitlist offer';
  END IF;
  IF v_offer_expires IS NULL OR v_offer_expires < now() THEN
    RAISE EXCEPTION 'offer has expired';
  END IF;

  -- Verify shift is still valid before accepting
  SELECT s.status::text,
         public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
    INTO v_shift_status, v_shift_end
    FROM public.shifts s WHERE s.id = v_shift_id;

  IF v_shift_status = 'cancelled' THEN
    RAISE EXCEPTION 'shift was cancelled';
  END IF;
  IF v_shift_end <= now() THEN
    RAISE EXCEPTION 'shift has already ended';
  END IF;

  UPDATE public.shift_bookings
  SET booking_status = 'confirmed',
      waitlist_offer_expires_at = NULL,
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
  VALUES (
    v_volunteer_id,
    'booking_confirmed',
    'Shift confirmed',
    'You are now confirmed for the shift.',
    '/dashboard',
    false
  );
END;
$$;


ALTER FUNCTION "public"."waitlist_accept"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."waitlist_decline"("p_booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_slot_id uuid;
BEGIN
  SELECT volunteer_id, shift_id, time_slot_id INTO v_volunteer_id, v_shift_id, v_slot_id
    FROM public.shift_bookings WHERE id = p_booking_id;
  IF v_volunteer_id IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF v_volunteer_id <> auth.uid() THEN RAISE EXCEPTION 'not your booking'; END IF;
  DELETE FROM public.shift_bookings WHERE id = p_booking_id;
  PERFORM public.promote_next_waitlist(v_shift_id, v_slot_id);
END;
$$;


ALTER FUNCTION "public"."waitlist_decline"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."warn_expiring_documents"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  rec record;
BEGIN
  -- ── Step 1: Mark approved documents expiring within 30 days ──
  FOR rec IN
    UPDATE volunteer_documents
    SET status = 'expiring_soon', updated_at = now()
    WHERE status = 'approved'
      AND expires_at IS NOT NULL
      AND expires_at <= now() + interval '30 days'
      AND expires_at > now()
    RETURNING id, volunteer_id, document_type_id, expires_at
  LOOP
    INSERT INTO notifications (user_id, type, title, message, link, is_read, data)
    SELECT
      rec.volunteer_id,
      'document_expiry_warning',
      'Document expiring soon: ' || dt.name,
      'Your "' || dt.name || '" document expires on ' ||
        to_char(rec.expires_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') ||
        ' (' || EXTRACT(DAY FROM (rec.expires_at - now()))::int || ' days remaining). ' ||
        'Please upload a renewed copy before it expires.',
      '/documents',
      false,
      jsonb_build_object(
        'document_id', rec.id,
        'document_type', dt.name,
        'expires_at', rec.expires_at,
        'days_remaining', EXTRACT(DAY FROM (rec.expires_at - now()))::int
      )
    FROM document_types dt
    WHERE dt.id = rec.document_type_id
    -- Don't send duplicate warnings (1 per document per 7 days)
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = rec.volunteer_id
        AND n.type = 'document_expiry_warning'
        AND (n.data->>'document_id')::uuid = rec.id
        AND n.created_at > now() - interval '7 days'
    );
  END LOOP;

  -- ── Step 2: Mark expired documents ──
  FOR rec IN
    UPDATE volunteer_documents
    SET status = 'expired', updated_at = now()
    WHERE status IN ('approved', 'expiring_soon')
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING id, volunteer_id, document_type_id, expires_at
  LOOP
    INSERT INTO notifications (user_id, type, title, message, link, is_read, data)
    SELECT
      rec.volunteer_id,
      'document_expired',
      'Document expired: ' || dt.name,
      'Your "' || dt.name || '" document expired on ' ||
        to_char(rec.expires_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') ||
        '. Please upload a renewed copy to maintain your eligibility.',
      '/documents',
      false,
      jsonb_build_object(
        'document_id', rec.id,
        'document_type', dt.name,
        'expires_at', rec.expires_at
      )
    FROM document_types dt
    WHERE dt.id = rec.document_type_id
    -- Don't send duplicate expired notifications
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = rec.volunteer_id
        AND n.type = 'document_expired'
        AND (n.data->>'document_id')::uuid = rec.id
    );
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."warn_expiring_documents"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_action_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_action_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_mfa_resets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reset_by" "text" NOT NULL,
    "target_user_id" "uuid" NOT NULL,
    "target_email" "text" NOT NULL,
    "reset_method" "text" DEFAULT 'rpc'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_mfa_resets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "coordinator_id" "uuid" NOT NULL,
    "volunteer_status" "text" NOT NULL,
    "volunteer_reported_hours" numeric,
    "coordinator_status" "text" NOT NULL,
    "admin_decision" "text",
    "admin_decided_by" "uuid",
    "admin_decided_at" timestamp with time zone,
    "admin_notes" "text",
    "resolved_by" "text",
    "final_hours_awarded" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    CONSTRAINT "attendance_disputes_admin_decision_check" CHECK (("admin_decision" = ANY (ARRAY['volunteer_upheld'::"text", 'coordinator_upheld'::"text"]))),
    CONSTRAINT "attendance_disputes_resolved_by_check" CHECK (("resolved_by" = ANY (ARRAY['admin'::"text", 'auto_timeout'::"text"])))
);


ALTER TABLE "public"."attendance_disputes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkin_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "rotation_mode" "text" DEFAULT 'none'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    CONSTRAINT "checkin_tokens_rotation_mode_check" CHECK (("rotation_mode" = ANY (ARRAY['none'::"text", 'daily'::"text", 'weekly'::"text", 'monthly'::"text"])))
);


ALTER TABLE "public"."checkin_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."confirmation_reminders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "recipient_type" "public"."reminder_recipient" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reminder_number" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."confirmation_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "cleared_at" timestamp with time zone
);


ALTER TABLE "public"."conversation_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject" "text",
    "conversation_type" "text" DEFAULT 'direct'::"text" NOT NULL,
    "department_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversations_conversation_type_check" CHECK (("conversation_type" = ANY (ARRAY['direct'::"text", 'bulk'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_coordinators" (
    "department_id" "uuid" NOT NULL,
    "coordinator_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."department_coordinators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_restrictions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "restricted_by" "uuid" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."department_restrictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "requires_bg_check" boolean DEFAULT true NOT NULL,
    "min_age" integer DEFAULT 18 NOT NULL,
    "allows_groups" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_required" boolean DEFAULT false NOT NULL,
    "has_expiry" boolean DEFAULT false NOT NULL,
    "expiry_days" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."document_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_registrations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "registered_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."event_registrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "event_date" "date" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "location" "text",
    "max_attendees" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "requires_bg_check" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "city" "text",
    "state" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "timezone" "text" DEFAULT 'America/Chicago'::"text" NOT NULL
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_backup_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mfa_backup_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "link" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data" "jsonb"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parental_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "parent_name" "text" NOT NULL,
    "parent_email" "text" NOT NULL,
    "parent_phone" "text",
    "consent_given_at" timestamp with time zone DEFAULT "now"(),
    "consent_method" "text" DEFAULT 'digital'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."parental_consents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_note_access_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "note_id" "uuid" NOT NULL,
    "access_reason" "text" NOT NULL,
    "accessed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "private_note_access_log_access_reason_check" CHECK (("char_length"("access_reason") >= 20))
);


ALTER TABLE "public"."private_note_access_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "emergency_contact" "text",
    "role" "public"."user_role" DEFAULT 'volunteer'::"public"."user_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "booking_privileges" boolean DEFAULT true NOT NULL,
    "bg_check_status" "public"."bg_check_status" DEFAULT 'pending'::"public"."bg_check_status" NOT NULL,
    "bg_check_updated_at" timestamp with time zone,
    "bg_check_expires_at" timestamp with time zone,
    "location_id" "uuid",
    "consistency_score" numeric(5,2) DEFAULT 0,
    "extended_booking" boolean DEFAULT false NOT NULL,
    "total_hours" numeric(8,2) DEFAULT 0 NOT NULL,
    "onboarding_complete" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tos_accepted_at" timestamp with time zone,
    "notif_email" boolean DEFAULT true NOT NULL,
    "notif_in_app" boolean DEFAULT true NOT NULL,
    "notif_sms" boolean DEFAULT false NOT NULL,
    "phone_verified" boolean DEFAULT false NOT NULL,
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "avatar_url" "text",
    "volunteer_points" integer DEFAULT 0,
    "notif_shift_reminders" boolean DEFAULT true,
    "notif_new_messages" boolean DEFAULT true,
    "notif_milestone" boolean DEFAULT true,
    "notif_document_expiry" boolean DEFAULT true,
    "notif_booking_changes" boolean DEFAULT true,
    "calendar_token" "uuid" DEFAULT "gen_random_uuid"(),
    "username" "public"."citext",
    "messaging_blocked" boolean DEFAULT false NOT NULL,
    "signin_count" integer DEFAULT 0 NOT NULL,
    "date_of_birth" "date",
    "is_minor" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_username_format_chk" CHECK ((("username" IS NULL) OR ((("length"(("username")::"text") >= 3) AND ("length"(("username")::"text") <= 30)) AND (("username")::"text" ~ '^[A-Za-z0-9_]+$'::"text"))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_attachments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "note_id" "uuid" NOT NULL,
    "uploader_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_size" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_booking_slots" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "slot_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_booking_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_bookings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "booking_status" "public"."booking_status" DEFAULT 'confirmed'::"public"."booking_status" NOT NULL,
    "confirmation_status" "public"."confirmation_status" DEFAULT 'pending_confirmation'::"public"."confirmation_status" NOT NULL,
    "confirmed_by" "uuid",
    "confirmed_at" timestamp with time zone,
    "is_group_booking" boolean DEFAULT false NOT NULL,
    "group_name" "text",
    "group_size" integer,
    "counted_in_consistency" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checked_in_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "late_cancel_notified" boolean DEFAULT false NOT NULL,
    "volunteer_reported_hours" numeric(5,2),
    "coordinator_reported_hours" numeric(5,2),
    "final_hours" numeric(5,2),
    "hours_source" "text",
    "promoted_at" timestamp with time zone,
    "waitlist_offer_expires_at" timestamp with time zone,
    "time_slot_id" "uuid",
    "coordinator_status" "text",
    "coordinator_actioned_at" timestamp with time zone,
    "coordinator_actioned_by" "uuid",
    "checked_in" boolean DEFAULT false,
    CONSTRAINT "shift_bookings_coordinator_status_check" CHECK (("coordinator_status" = ANY (ARRAY['attended'::"text", 'absent'::"text"])))
);


ALTER TABLE "public"."shift_bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shifts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "shift_date" "date" NOT NULL,
    "time_type" "public"."shift_time_type" DEFAULT 'morning'::"public"."shift_time_type" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "total_slots" integer DEFAULT 1 NOT NULL,
    "booked_slots" integer DEFAULT 0 NOT NULL,
    "requires_bg_check" boolean DEFAULT true NOT NULL,
    "status" "public"."shift_status" DEFAULT 'open'::"public"."shift_status" NOT NULL,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "recurrence_rule" "text",
    "recurrence_parent" "uuid",
    "allows_group" boolean DEFAULT false NOT NULL,
    "max_group_size" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "coordinator_note" "text",
    "note_updated_at" timestamp with time zone,
    CONSTRAINT "chk_recurrence_rule" CHECK ((("recurrence_rule" IS NULL) OR ("recurrence_rule" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'biweekly'::"text", 'monthly'::"text"])))),
    CONSTRAINT "chk_slots" CHECK ((("booked_slots" >= 0) AND ("booked_slots" <= "total_slots")))
);


ALTER TABLE "public"."shifts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."shift_fill_rates" AS
 SELECT "id" AS "shift_id",
    "total_slots",
    "booked_slots",
    "department_id",
    "shift_date",
    "time_type",
    EXTRACT(dow FROM "shift_date") AS "day_of_week",
        CASE
            WHEN ("total_slots" = 0) THEN (0)::numeric
            ELSE "round"((("booked_slots")::numeric / ("total_slots")::numeric), 4)
        END AS "fill_ratio"
   FROM "public"."shifts" "s"
  WHERE (("status" <> 'cancelled'::"public"."shift_status") AND ("shift_date" >= CURRENT_DATE));


ALTER VIEW "public"."shift_fill_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_invitations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "invite_email" "text" NOT NULL,
    "invite_name" "text",
    "token" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "volunteer_id" "uuid",
    CONSTRAINT "shift_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."shift_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_notes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."shift_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_recurrence_rules" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "time_type" "public"."shift_time_type" DEFAULT 'morning'::"public"."shift_time_type" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "total_slots" integer DEFAULT 1 NOT NULL,
    "requires_bg_check" boolean DEFAULT true NOT NULL,
    "allows_group" boolean DEFAULT false NOT NULL,
    "recurrence_type" "public"."recurrence_type" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_end_after_start" CHECK (("end_date" > "start_date")),
    CONSTRAINT "chk_max_6_months" CHECK (("end_date" <= ("start_date" + '6 mons'::interval)))
);


ALTER TABLE "public"."shift_recurrence_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_time_slots" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "slot_start" time without time zone NOT NULL,
    "slot_end" time without time zone NOT NULL,
    "total_slots" integer DEFAULT 1 NOT NULL,
    "booked_slots" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_slot_slots" CHECK ((("booked_slots" >= 0) AND ("booked_slots" <= "total_slots"))),
    CONSTRAINT "chk_slot_times" CHECK (("slot_end" > "slot_start"))
);


ALTER TABLE "public"."shift_time_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteer_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "document_type_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "file_size" integer,
    "storage_path" "text" NOT NULL,
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_note" "text",
    "expires_at" timestamp with time zone,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "volunteer_documents_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'approved'::"text", 'rejected'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."volunteer_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteer_preferences" (
    "volunteer_id" "uuid" NOT NULL,
    "day_of_week_affinity" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "time_of_day_affinity" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "department_affinity" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "avg_advance_booking_days" double precision DEFAULT 7 NOT NULL,
    "total_interactions" integer DEFAULT 0 NOT NULL,
    "reliability_alpha" double precision DEFAULT 2 NOT NULL,
    "reliability_beta" double precision DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."volunteer_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteer_private_notes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "shift_id" "uuid",
    "department_id" "uuid",
    "title" "text",
    "content" "text" NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."volunteer_private_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteer_shift_interactions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "interaction_type" "public"."interaction_type" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."volunteer_shift_interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volunteer_shift_reports" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "volunteer_id" "uuid" NOT NULL,
    "self_confirm_status" "public"."self_confirm_status" DEFAULT 'pending'::"public"."self_confirm_status" NOT NULL,
    "self_reported_hours" numeric(5,2),
    "star_rating" integer,
    "shift_feedback" "text",
    "submitted_at" timestamp with time zone,
    "reminder_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "volunteer_shift_reports_star_rating_check" CHECK ((("star_rating" >= 1) AND ("star_rating" <= 5)))
);


ALTER TABLE "public"."volunteer_shift_reports" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."volunteer_shift_reports_safe" WITH ("security_barrier"='true') AS
 SELECT "id",
    "booking_id",
    "volunteer_id",
    "self_confirm_status",
    "self_reported_hours",
    "reminder_sent_at",
    "submitted_at",
    "created_at",
    "updated_at"
   FROM "public"."volunteer_shift_reports";


ALTER VIEW "public"."volunteer_shift_reports_safe" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_action_log"
    ADD CONSTRAINT "admin_action_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_mfa_resets"
    ADD CONSTRAINT "admin_mfa_resets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_disputes"
    ADD CONSTRAINT "attendance_disputes_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."attendance_disputes"
    ADD CONSTRAINT "attendance_disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkin_tokens"
    ADD CONSTRAINT "checkin_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkin_tokens"
    ADD CONSTRAINT "checkin_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."confirmation_reminders"
    ADD CONSTRAINT "confirmation_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_user_id_key" UNIQUE ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_coordinators"
    ADD CONSTRAINT "department_coordinators_pkey" PRIMARY KEY ("department_id", "coordinator_id");



ALTER TABLE ONLY "public"."department_restrictions"
    ADD CONSTRAINT "department_restrictions_department_id_volunteer_id_key" UNIQUE ("department_id", "volunteer_id");



ALTER TABLE ONLY "public"."department_restrictions"
    ADD CONSTRAINT "department_restrictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_types"
    ADD CONSTRAINT "document_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_event_id_volunteer_id_key" UNIQUE ("event_id", "volunteer_id");



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mfa_backup_codes"
    ADD CONSTRAINT "mfa_backup_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parental_consents"
    ADD CONSTRAINT "parental_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_note_access_log"
    ADD CONSTRAINT "private_note_access_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_attachments"
    ADD CONSTRAINT "shift_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_booking_slots"
    ADD CONSTRAINT "shift_booking_slots_booking_id_slot_id_key" UNIQUE ("booking_id", "slot_id");



ALTER TABLE ONLY "public"."shift_booking_slots"
    ADD CONSTRAINT "shift_booking_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_bookings"
    ADD CONSTRAINT "shift_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_bookings"
    ADD CONSTRAINT "shift_bookings_shift_id_volunteer_id_key" UNIQUE ("shift_id", "volunteer_id");



ALTER TABLE ONLY "public"."shift_invitations"
    ADD CONSTRAINT "shift_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_invitations"
    ADD CONSTRAINT "shift_invitations_shift_id_invite_email_key" UNIQUE ("shift_id", "invite_email");



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_recurrence_rules"
    ADD CONSTRAINT "shift_recurrence_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_time_slots"
    ADD CONSTRAINT "shift_time_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_time_slots"
    ADD CONSTRAINT "uq_shift_slot_times" UNIQUE ("shift_id", "slot_start", "slot_end");



ALTER TABLE ONLY "public"."volunteer_documents"
    ADD CONSTRAINT "volunteer_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."volunteer_preferences"
    ADD CONSTRAINT "volunteer_preferences_pkey" PRIMARY KEY ("volunteer_id");



ALTER TABLE ONLY "public"."volunteer_private_notes"
    ADD CONSTRAINT "volunteer_private_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."volunteer_shift_interactions"
    ADD CONSTRAINT "volunteer_shift_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."volunteer_shift_reports"
    ADD CONSTRAINT "volunteer_shift_reports_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."volunteer_shift_reports"
    ADD CONSTRAINT "volunteer_shift_reports_pkey" PRIMARY KEY ("id");



CREATE INDEX "conversation_participants_cleared_at_idx" ON "public"."conversation_participants" USING "btree" ("user_id", "cleared_at");



CREATE INDEX "idx_attendance_disputes_booking" ON "public"."attendance_disputes" USING "btree" ("booking_id");



CREATE INDEX "idx_attendance_disputes_pending" ON "public"."attendance_disputes" USING "btree" ("admin_decision") WHERE ("admin_decision" IS NULL);



CREATE INDEX "idx_booking_slots_booking" ON "public"."shift_booking_slots" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_slots_slot" ON "public"."shift_booking_slots" USING "btree" ("slot_id");



CREATE INDEX "idx_bookings_conf_status" ON "public"."shift_bookings" USING "btree" ("confirmation_status");



CREATE INDEX "idx_bookings_confirmation_status" ON "public"."shift_bookings" USING "btree" ("confirmation_status", "booking_status");



CREATE INDEX "idx_bookings_shift" ON "public"."shift_bookings" USING "btree" ("shift_id");



CREATE INDEX "idx_bookings_shift_status" ON "public"."shift_bookings" USING "btree" ("shift_id", "booking_status");



CREATE INDEX "idx_bookings_volunteer" ON "public"."shift_bookings" USING "btree" ("volunteer_id");



CREATE INDEX "idx_conversation_participants_convo" ON "public"."conversation_participants" USING "btree" ("conversation_id");



CREATE INDEX "idx_conversation_participants_user" ON "public"."conversation_participants" USING "btree" ("user_id");



CREATE INDEX "idx_interactions_shift" ON "public"."volunteer_shift_interactions" USING "btree" ("shift_id");



CREATE INDEX "idx_interactions_volunteer" ON "public"."volunteer_shift_interactions" USING "btree" ("volunteer_id");



CREATE INDEX "idx_invitations_shift" ON "public"."shift_invitations" USING "btree" ("shift_id");



CREATE INDEX "idx_invitations_token" ON "public"."shift_invitations" USING "btree" ("token");



CREATE UNIQUE INDEX "idx_max_two_admins" ON "public"."profiles" USING "btree" ("role") WHERE ("role" = 'admin'::"public"."user_role");



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_sender" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_notes_booking" ON "public"."shift_notes" USING "btree" ("booking_id");



CREATE INDEX "idx_notifications_read_age" ON "public"."notifications" USING "btree" ("is_read", "created_at") WHERE ("is_read" = true);



CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_private_notes_shift" ON "public"."volunteer_private_notes" USING "btree" ("shift_id");



CREATE INDEX "idx_private_notes_volunteer" ON "public"."volunteer_private_notes" USING "btree" ("volunteer_id");



CREATE UNIQUE INDEX "idx_profiles_calendar_token" ON "public"."profiles" USING "btree" ("calendar_token");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_reminders_booking" ON "public"."confirmation_reminders" USING "btree" ("booking_id");



CREATE INDEX "idx_reports_booking" ON "public"."volunteer_shift_reports" USING "btree" ("booking_id");



CREATE INDEX "idx_reports_volunteer" ON "public"."volunteer_shift_reports" USING "btree" ("volunteer_id");



CREATE INDEX "idx_restrictions_department" ON "public"."department_restrictions" USING "btree" ("department_id");



CREATE INDEX "idx_restrictions_volunteer" ON "public"."department_restrictions" USING "btree" ("volunteer_id");



CREATE INDEX "idx_shift_bookings_time_slot_id" ON "public"."shift_bookings" USING "btree" ("time_slot_id") WHERE ("time_slot_id" IS NOT NULL);



CREATE INDEX "idx_shifts_date" ON "public"."shifts" USING "btree" ("shift_date");



CREATE INDEX "idx_shifts_department" ON "public"."shifts" USING "btree" ("department_id");



CREATE INDEX "idx_time_slots_shift" ON "public"."shift_time_slots" USING "btree" ("shift_id");



CREATE INDEX "idx_volunteer_documents_expiry" ON "public"."volunteer_documents" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "idx_volunteer_documents_status" ON "public"."volunteer_documents" USING "btree" ("status");



CREATE INDEX "idx_volunteer_documents_type" ON "public"."volunteer_documents" USING "btree" ("document_type_id");



CREATE INDEX "idx_volunteer_documents_volunteer" ON "public"."volunteer_documents" USING "btree" ("volunteer_id");



CREATE INDEX "mfa_backup_codes_user_id_idx" ON "public"."mfa_backup_codes" USING "btree" ("user_id") WHERE ("used_at" IS NULL);



CREATE UNIQUE INDEX "profiles_username_unique_idx" ON "public"."profiles" USING "btree" ("username") WHERE ("username" IS NOT NULL);



CREATE INDEX "shift_bookings_waitlist_offer_idx" ON "public"."shift_bookings" USING "btree" ("waitlist_offer_expires_at") WHERE ("waitlist_offer_expires_at" IS NOT NULL);



CREATE UNIQUE INDEX "uq_booking_per_slot" ON "public"."shift_bookings" USING "btree" ("shift_id", "volunteer_id", "time_slot_id") WHERE (("time_slot_id" IS NOT NULL) AND ("booking_status" = ANY (ARRAY['confirmed'::"public"."booking_status", 'waitlisted'::"public"."booking_status"])));



CREATE UNIQUE INDEX "uq_shift_invitation_volunteer" ON "public"."shift_invitations" USING "btree" ("shift_id", "volunteer_id") WHERE (("volunteer_id" IS NOT NULL) AND ("status" = 'pending'::"text"));



CREATE OR REPLACE TRIGGER "trg_admin_cap" BEFORE INSERT OR UPDATE OF "role" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_admin_cap"();



CREATE OR REPLACE TRIGGER "trg_booking_window" BEFORE INSERT ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_booking_window"();



CREATE OR REPLACE TRIGGER "trg_bookings_updated_at" BEFORE UPDATE ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cancel_bookings_on_delete" BEFORE DELETE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."cancel_bookings_on_profile_delete"();



CREATE OR REPLACE TRIGGER "trg_cascade_bg_check_expiry" AFTER UPDATE OF "bg_check_status" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_bg_check_expiry"();



CREATE OR REPLACE TRIGGER "trg_check_attendance_dispute" BEFORE UPDATE OF "coordinator_status" ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."check_attendance_dispute"();



CREATE OR REPLACE TRIGGER "trg_cleanup_notifications_on_booking_delete" AFTER DELETE ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_notifications_for_booking"();



CREATE OR REPLACE TRIGGER "trg_cleanup_notifications_on_shift_delete" AFTER DELETE ON "public"."shifts" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_notifications_for_shift"();



CREATE OR REPLACE TRIGGER "trg_create_self_confirmation" AFTER UPDATE OF "confirmation_status" ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."create_self_confirmation_report"();



CREATE OR REPLACE TRIGGER "trg_email_on_notification" AFTER INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."notify_email_on_notification"();



CREATE OR REPLACE TRIGGER "trg_enforce_dept_restriction" BEFORE INSERT ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_department_restriction"();



CREATE OR REPLACE TRIGGER "trg_enforce_eligibility_on_profile_update" AFTER UPDATE OF "booking_privileges", "bg_check_status" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_eligibility_on_profile_update"();



CREATE OR REPLACE TRIGGER "trg_enforce_shift_not_ended_insert" BEFORE INSERT ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_shift_not_ended_on_booking"();



CREATE OR REPLACE TRIGGER "trg_enforce_shift_not_ended_update" BEFORE UPDATE ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_shift_not_ended_on_booking"();



CREATE OR REPLACE TRIGGER "trg_generate_time_slots" AFTER INSERT ON "public"."shifts" FOR EACH ROW EXECUTE FUNCTION "public"."generate_shift_time_slots"();



CREATE OR REPLACE TRIGGER "trg_interaction_update_preferences" AFTER INSERT ON "public"."volunteer_shift_interactions" FOR EACH ROW EXECUTE FUNCTION "public"."trg_update_preferences_on_interaction"();



CREATE OR REPLACE TRIGGER "trg_notes_updated_at" BEFORE UPDATE ON "public"."shift_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_prevent_overlapping_bookings" BEFORE INSERT OR UPDATE ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_overlapping_bookings"();



CREATE OR REPLACE TRIGGER "trg_prevent_role_self_escalation" BEFORE UPDATE OF "role" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_role_self_escalation"();



CREATE OR REPLACE TRIGGER "trg_private_notes_updated_at" BEFORE UPDATE ON "public"."volunteer_private_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_recalc_consistency" AFTER UPDATE OF "confirmation_status" ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalc_consistency_fn"();



CREATE OR REPLACE TRIGGER "trg_recalculate_consistency" AFTER UPDATE OF "confirmation_status" ON "public"."shift_bookings" FOR EACH ROW WHEN (("old"."confirmation_status" IS DISTINCT FROM "new"."confirmation_status")) EXECUTE FUNCTION "public"."trg_recalculate_consistency_fn"();



CREATE OR REPLACE TRIGGER "trg_recalculate_consistency_delete" AFTER DELETE ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalculate_consistency_fn"();



CREATE OR REPLACE TRIGGER "trg_recalculate_points_booking_status" AFTER UPDATE OF "booking_status" ON "public"."shift_bookings" FOR EACH ROW WHEN (("old"."booking_status" IS DISTINCT FROM "new"."booking_status")) EXECUTE FUNCTION "public"."trg_recalculate_points_fn"();



CREATE OR REPLACE TRIGGER "trg_recalculate_points_delete" AFTER DELETE ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_recalculate_points_fn"();



CREATE OR REPLACE TRIGGER "trg_recalculate_points_update" AFTER UPDATE OF "confirmation_status" ON "public"."shift_bookings" FOR EACH ROW WHEN (("old"."confirmation_status" IS DISTINCT FROM "new"."confirmation_status")) EXECUTE FUNCTION "public"."trg_recalculate_points_fn"();



CREATE OR REPLACE TRIGGER "trg_reports_updated_at" BEFORE UPDATE ON "public"."volunteer_shift_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_shift_status" BEFORE UPDATE OF "booked_slots" ON "public"."shifts" FOR EACH ROW EXECUTE FUNCTION "public"."update_shift_status"();



CREATE OR REPLACE TRIGGER "trg_shifts_updated_at" BEFORE UPDATE ON "public"."shifts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_is_minor" BEFORE INSERT OR UPDATE OF "date_of_birth" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_is_minor"();



CREATE OR REPLACE TRIGGER "trg_sync_slot_count" AFTER INSERT OR DELETE ON "public"."shift_booking_slots" FOR EACH ROW EXECUTE FUNCTION "public"."sync_slot_booked_count"();



CREATE OR REPLACE TRIGGER "trg_sync_slots" AFTER INSERT ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_booked_slots"();



CREATE OR REPLACE TRIGGER "trg_sync_slots_update" AFTER UPDATE OF "booking_status" ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_booked_slots"();



CREATE OR REPLACE TRIGGER "trg_sync_volunteer_hours" AFTER INSERT OR UPDATE OF "self_reported_hours" ON "public"."volunteer_shift_reports" FOR EACH ROW EXECUTE FUNCTION "public"."sync_volunteer_reported_hours"();



CREATE OR REPLACE TRIGGER "trg_validate_booking_slots" BEFORE INSERT ON "public"."shift_bookings" FOR EACH ROW WHEN (("new"."booking_status" = 'confirmed'::"public"."booking_status")) EXECUTE FUNCTION "public"."validate_booking_slot_count"();



CREATE OR REPLACE TRIGGER "trg_validate_booking_slots_update" BEFORE UPDATE ON "public"."shift_bookings" FOR EACH ROW WHEN ((("old"."booking_status" IS DISTINCT FROM 'confirmed'::"public"."booking_status") AND ("new"."booking_status" = 'confirmed'::"public"."booking_status"))) EXECUTE FUNCTION "public"."validate_booking_slot_count"();



CREATE OR REPLACE TRIGGER "trg_volunteer_only_booking" BEFORE INSERT ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_volunteer_only_booking"();



CREATE OR REPLACE TRIGGER "trg_waitlist_promote" AFTER UPDATE OF "booking_status" ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_waitlist_promote_on_cancel"();



CREATE OR REPLACE TRIGGER "trg_waitlist_promote_delete" AFTER DELETE ON "public"."shift_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_waitlist_promote_on_delete"();



ALTER TABLE ONLY "public"."admin_action_log"
    ADD CONSTRAINT "admin_action_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."admin_action_log"
    ADD CONSTRAINT "admin_action_log_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."attendance_disputes"
    ADD CONSTRAINT "attendance_disputes_admin_decided_by_fkey" FOREIGN KEY ("admin_decided_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."attendance_disputes"
    ADD CONSTRAINT "attendance_disputes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."shift_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_disputes"
    ADD CONSTRAINT "attendance_disputes_coordinator_id_fkey" FOREIGN KEY ("coordinator_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."attendance_disputes"
    ADD CONSTRAINT "attendance_disputes_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id");



ALTER TABLE ONLY "public"."attendance_disputes"
    ADD CONSTRAINT "attendance_disputes_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."confirmation_reminders"
    ADD CONSTRAINT "confirmation_reminders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."shift_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."confirmation_reminders"
    ADD CONSTRAINT "confirmation_reminders_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."department_coordinators"
    ADD CONSTRAINT "department_coordinators_coordinator_id_fkey" FOREIGN KEY ("coordinator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_coordinators"
    ADD CONSTRAINT "department_coordinators_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_restrictions"
    ADD CONSTRAINT "department_restrictions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_restrictions"
    ADD CONSTRAINT "department_restrictions_restricted_by_fkey" FOREIGN KEY ("restricted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."department_restrictions"
    ADD CONSTRAINT "department_restrictions_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."document_types"
    ADD CONSTRAINT "document_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_registrations"
    ADD CONSTRAINT "event_registrations_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."mfa_backup_codes"
    ADD CONSTRAINT "mfa_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parental_consents"
    ADD CONSTRAINT "parental_consents_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_note_access_log"
    ADD CONSTRAINT "private_note_access_log_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."private_note_access_log"
    ADD CONSTRAINT "private_note_access_log_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."shift_attachments"
    ADD CONSTRAINT "shift_attachments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "public"."shift_notes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_attachments"
    ADD CONSTRAINT "shift_attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shift_booking_slots"
    ADD CONSTRAINT "shift_booking_slots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."shift_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_booking_slots"
    ADD CONSTRAINT "shift_booking_slots_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."shift_time_slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_bookings"
    ADD CONSTRAINT "shift_bookings_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shift_bookings"
    ADD CONSTRAINT "shift_bookings_coordinator_actioned_by_fkey" FOREIGN KEY ("coordinator_actioned_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shift_bookings"
    ADD CONSTRAINT "shift_bookings_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_bookings"
    ADD CONSTRAINT "shift_bookings_time_slot_id_fkey" FOREIGN KEY ("time_slot_id") REFERENCES "public"."shift_time_slots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_bookings"
    ADD CONSTRAINT "shift_bookings_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shift_invitations"
    ADD CONSTRAINT "shift_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shift_invitations"
    ADD CONSTRAINT "shift_invitations_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_invitations"
    ADD CONSTRAINT "shift_invitations_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shift_notes"
    ADD CONSTRAINT "shift_notes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."shift_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_recurrence_rules"
    ADD CONSTRAINT "shift_recurrence_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shift_recurrence_rules"
    ADD CONSTRAINT "shift_recurrence_rules_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."shift_time_slots"
    ADD CONSTRAINT "shift_time_slots_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id");



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_recurrence_parent_fkey" FOREIGN KEY ("recurrence_parent") REFERENCES "public"."shifts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."volunteer_documents"
    ADD CONSTRAINT "volunteer_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id");



ALTER TABLE ONLY "public"."volunteer_documents"
    ADD CONSTRAINT "volunteer_documents_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."volunteer_documents"
    ADD CONSTRAINT "volunteer_documents_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_preferences"
    ADD CONSTRAINT "volunteer_preferences_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_private_notes"
    ADD CONSTRAINT "volunteer_private_notes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."volunteer_private_notes"
    ADD CONSTRAINT "volunteer_private_notes_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."volunteer_private_notes"
    ADD CONSTRAINT "volunteer_private_notes_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_shift_interactions"
    ADD CONSTRAINT "volunteer_shift_interactions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_shift_interactions"
    ADD CONSTRAINT "volunteer_shift_interactions_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_shift_reports"
    ADD CONSTRAINT "volunteer_shift_reports_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."shift_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."volunteer_shift_reports"
    ADD CONSTRAINT "volunteer_shift_reports_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "public"."profiles"("id");



CREATE POLICY "Admins can manage all invitations" ON "public"."shift_invitations" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can manage checkin_tokens" ON "public"."checkin_tokens" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can read all logs" ON "public"."admin_action_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins manage document types" ON "public"."document_types" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins update documents" ON "public"."volunteer_documents" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Authenticated users can insert invitations" ON "public"."shift_invitations" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users create conversations" ON "public"."conversations" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = "auth"."uid"()) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."messaging_blocked" = true)))))));



CREATE POLICY "Authenticated users read active document types" ON "public"."document_types" FOR SELECT TO "authenticated" USING (("is_active" = true));



CREATE POLICY "Coordinators and admins read all documents" ON "public"."volunteer_documents" FOR SELECT TO "authenticated" USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "Creator or staff adds participants" ON "public"."conversation_participants" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "conversation_participants"."conversation_id") AND ("conversations"."created_by" = "auth"."uid"())))) OR "public"."is_coordinator_or_admin"()));



CREATE POLICY "Participants read conversations" ON "public"."conversations" FOR SELECT TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "conversations"."id") AND ("conversation_participants"."user_id" = "auth"."uid"())))) OR "public"."is_admin"()));



CREATE POLICY "Participants read messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "messages"."conversation_id") AND ("conversation_participants"."user_id" = "auth"."uid"())))) OR "public"."is_admin"()));



CREATE POLICY "Participants send messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "messages"."conversation_id") AND ("conversation_participants"."user_id" = "auth"."uid"())))) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."messaging_blocked" = true)))))));



CREATE POLICY "Participants update conversations" ON "public"."conversations" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "conversations"."id") AND ("conversation_participants"."user_id" = "auth"."uid"())))) OR "public"."is_admin"()));



CREATE POLICY "Service role can insert logs" ON "public"."admin_action_log" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users read own participations" ON "public"."conversation_participants" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Users update own participation" ON "public"."conversation_participants" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Volunteers can read own invitations" ON "public"."shift_invitations" FOR SELECT USING ((("volunteer_id" = "auth"."uid"()) OR ("invited_by" = "auth"."uid"())));



CREATE POLICY "Volunteers can update own invitation status" ON "public"."shift_invitations" FOR UPDATE USING (("volunteer_id" = "auth"."uid"())) WITH CHECK (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "Volunteers delete own pending documents" ON "public"."volunteer_documents" FOR DELETE TO "authenticated" USING ((("volunteer_id" = "auth"."uid"()) AND ("status" = 'pending_review'::"text")));



CREATE POLICY "Volunteers read own documents" ON "public"."volunteer_documents" FOR SELECT TO "authenticated" USING (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "Volunteers upload own documents" ON "public"."volunteer_documents" FOR INSERT TO "authenticated" WITH CHECK (("volunteer_id" = "auth"."uid"()));



ALTER TABLE "public"."admin_action_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_mfa_resets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_mfa_resets: admin read" ON "public"."admin_mfa_resets" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "attachments: coord/admin delete" ON "public"."shift_attachments" FOR DELETE USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "attachments: coord/admin read" ON "public"."shift_attachments" FOR SELECT USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "attachments: volunteer insert" ON "public"."shift_attachments" FOR INSERT WITH CHECK (("uploader_id" = "auth"."uid"()));



CREATE POLICY "attachments: volunteer own" ON "public"."shift_attachments" FOR SELECT USING (("uploader_id" = "auth"."uid"()));



CREATE POLICY "attachments: volunteer own delete" ON "public"."shift_attachments" FOR DELETE USING (("uploader_id" = "auth"."uid"()));



ALTER TABLE "public"."attendance_disputes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_disputes: admin full access" ON "public"."attendance_disputes" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "attendance_disputes: coordinator read own" ON "public"."attendance_disputes" FOR SELECT TO "authenticated" USING ((("coordinator_id" = "auth"."uid"()) AND "public"."is_coordinator_or_admin"()));



CREATE POLICY "attendance_disputes: volunteer read resolved" ON "public"."attendance_disputes" FOR SELECT TO "authenticated" USING ((("volunteer_id" = "auth"."uid"()) AND (("admin_decision" IS NOT NULL) OR ("now"() > "expires_at"))));



CREATE POLICY "booking_slots: coord/admin read" ON "public"."shift_booking_slots" FOR SELECT USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "booking_slots: volunteer delete own" ON "public"."shift_booking_slots" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."shift_bookings" "sb"
  WHERE (("sb"."id" = "shift_booking_slots"."booking_id") AND ("sb"."volunteer_id" = "auth"."uid"())))));



CREATE POLICY "booking_slots: volunteer insert" ON "public"."shift_booking_slots" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."shift_bookings" "sb"
  WHERE (("sb"."id" = "shift_booking_slots"."booking_id") AND ("sb"."volunteer_id" = "auth"."uid"())))));



CREATE POLICY "booking_slots: volunteer own" ON "public"."shift_booking_slots" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shift_bookings" "sb"
  WHERE (("sb"."id" = "shift_booking_slots"."booking_id") AND ("sb"."volunteer_id" = "auth"."uid"())))));



CREATE POLICY "bookings: coord confirm" ON "public"."shift_bookings" FOR UPDATE USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "bookings: coordinator dept" ON "public"."shift_bookings" FOR SELECT USING (("public"."is_coordinator_or_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."shifts" "s"
     JOIN "public"."department_coordinators" "dc" ON (("dc"."department_id" = "s"."department_id")))
  WHERE (("s"."id" = "shift_bookings"."shift_id") AND ("dc"."coordinator_id" = "auth"."uid"()))))));



CREATE POLICY "bookings: volunteer cancel" ON "public"."shift_bookings" FOR UPDATE USING (("volunteer_id" = "auth"."uid"())) WITH CHECK ((("volunteer_id" = "auth"."uid"()) AND (NOT ("confirmed_by" IS DISTINCT FROM "confirmed_by")) AND (NOT ("confirmation_status" IS DISTINCT FROM "confirmation_status")) AND (NOT ("final_hours" IS DISTINCT FROM "final_hours")) AND (NOT ("hours_source" IS DISTINCT FROM "hours_source")) AND (NOT ("coordinator_reported_hours" IS DISTINCT FROM "coordinator_reported_hours"))));



CREATE POLICY "bookings: volunteer insert" ON "public"."shift_bookings" FOR INSERT WITH CHECK (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "bookings: volunteer own" ON "public"."shift_bookings" FOR SELECT USING (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "break_glass_log: admin insert" ON "public"."private_note_access_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("admin_user_id" = "auth"."uid"())));



CREATE POLICY "break_glass_log: admin read" ON "public"."private_note_access_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "break_glass_log: deny delete" ON "public"."private_note_access_log" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "break_glass_log: deny update" ON "public"."private_note_access_log" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);



ALTER TABLE "public"."checkin_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."confirmation_reminders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consent: admin all" ON "public"."parental_consents" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "consent: coordinator read" ON "public"."parental_consents" FOR SELECT TO "authenticated" USING (("public"."is_coordinator_or_admin"() AND (EXISTS ( SELECT 1
   FROM (("public"."shift_bookings" "sb"
     JOIN "public"."shifts" "s" ON (("s"."id" = "sb"."shift_id")))
     JOIN "public"."department_coordinators" "dc" ON (("dc"."department_id" = "s"."department_id")))
  WHERE (("sb"."volunteer_id" = "parental_consents"."volunteer_id") AND ("dc"."coordinator_id" = "auth"."uid"()))))));



CREATE POLICY "consent: volunteer own insert" ON "public"."parental_consents" FOR INSERT TO "authenticated" WITH CHECK (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "consent: volunteer own read" ON "public"."parental_consents" FOR SELECT TO "authenticated" USING (("volunteer_id" = "auth"."uid"()));



ALTER TABLE "public"."conversation_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_coordinators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_restrictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "departments: admin write" ON "public"."departments" USING ("public"."is_admin"());



CREATE POLICY "departments: all read" ON "public"."departments" FOR SELECT USING (true);



CREATE POLICY "dept_coords: admin manage" ON "public"."department_coordinators" USING ("public"."is_admin"());



CREATE POLICY "dept_coords: coord read" ON "public"."department_coordinators" FOR SELECT USING ("public"."is_coordinator_or_admin"());



ALTER TABLE "public"."document_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_registrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_regs: admin read" ON "public"."event_registrations" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "event_regs: volunteer own" ON "public"."event_registrations" USING (("volunteer_id" = "auth"."uid"()));



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events: admin manage" ON "public"."events" USING ("public"."is_admin"());



CREATE POLICY "events: all read active" ON "public"."events" FOR SELECT USING (("is_active" = true));



CREATE POLICY "interactions: admin all" ON "public"."volunteer_shift_interactions" USING ("public"."is_admin"());



CREATE POLICY "interactions: volunteer insert" ON "public"."volunteer_shift_interactions" FOR INSERT WITH CHECK (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "interactions: volunteer own" ON "public"."volunteer_shift_interactions" FOR SELECT USING (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "invitations: coord/admin read" ON "public"."shift_invitations" FOR SELECT USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "invitations: own read" ON "public"."shift_invitations" FOR SELECT USING (("invited_by" = "auth"."uid"()));



CREATE POLICY "invitations: volunteer insert" ON "public"."shift_invitations" FOR INSERT WITH CHECK ((("invited_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."shift_bookings" "sb"
     JOIN "public"."shifts" "s" ON (("s"."id" = "sb"."shift_id")))
  WHERE (("sb"."shift_id" = "shift_invitations"."shift_id") AND ("sb"."volunteer_id" = "auth"."uid"()) AND ("sb"."booking_status" = 'confirmed'::"public"."booking_status") AND ("s"."requires_bg_check" = false))))));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations: admin write" ON "public"."locations" USING ("public"."is_admin"());



CREATE POLICY "locations: all read" ON "public"."locations" FOR SELECT USING (true);



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mfa_backup_codes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mfa_backup_codes: deny all client" ON "public"."mfa_backup_codes" TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "notes: admin lock" ON "public"."shift_notes" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "notes: coord/admin read" ON "public"."shift_notes" FOR SELECT USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "notes: volunteer insert" ON "public"."shift_notes" FOR INSERT WITH CHECK (("author_id" = "auth"."uid"()));



CREATE POLICY "notes: volunteer own" ON "public"."shift_notes" FOR SELECT USING (("author_id" = "auth"."uid"()));



CREATE POLICY "notes: volunteer update" ON "public"."shift_notes" FOR UPDATE USING ((("author_id" = "auth"."uid"()) AND ("is_locked" = false)));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications: admin read all" ON "public"."notifications" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "notifications: coord/admin insert" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("public"."is_coordinator_or_admin"() AND ((EXISTS ( SELECT 1
   FROM ((("public"."profiles" "p"
     JOIN "public"."shift_bookings" "sb" ON (("sb"."volunteer_id" = "p"."id")))
     JOIN "public"."shifts" "s" ON (("s"."id" = "sb"."shift_id")))
     JOIN "public"."department_coordinators" "dc" ON (("dc"."department_id" = "s"."department_id")))
  WHERE (("p"."id" = "notifications"."user_id") AND ("dc"."coordinator_id" = "auth"."uid"())))) OR ("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "notifications"."user_id") AND ("p"."role" = 'admin'::"public"."user_role"))))))));



CREATE POLICY "notifications: own read" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications: own update" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications: volunteer self insert" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'volunteer'::"public"."user_role"))))));



ALTER TABLE "public"."parental_consents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "preferences: admin all" ON "public"."volunteer_preferences" USING ("public"."is_admin"());



CREATE POLICY "preferences: system update" ON "public"."volunteer_preferences" FOR UPDATE USING (true);



CREATE POLICY "preferences: system upsert" ON "public"."volunteer_preferences" FOR INSERT WITH CHECK (true);



CREATE POLICY "preferences: volunteer own" ON "public"."volunteer_preferences" FOR SELECT USING (("volunteer_id" = "auth"."uid"()));



ALTER TABLE "public"."private_note_access_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "private_notes: volunteer only" ON "public"."volunteer_private_notes" USING (("volunteer_id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles: admin delete" ON "public"."profiles" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "profiles: admin read" ON "public"."profiles" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "profiles: admin update" ON "public"."profiles" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "profiles: admin update any" ON "public"."profiles" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "profiles: coordinator read dept volunteers" ON "public"."profiles" FOR SELECT USING ((("role" = 'volunteer'::"public"."user_role") AND ("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM (("public"."shift_bookings" "sb"
     JOIN "public"."shifts" "s" ON (("s"."id" = "sb"."shift_id")))
     JOIN "public"."department_coordinators" "dc" ON (("dc"."department_id" = "s"."department_id")))
  WHERE (("sb"."volunteer_id" = "profiles"."id") AND ("sb"."booking_status" = 'confirmed'::"public"."booking_status") AND ("dc"."coordinator_id" = "auth"."uid"())))))));



CREATE POLICY "profiles: insert self" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "profiles: own read" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles: own update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles: volunteer read admins and dept coordinators" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("role" = 'admin'::"public"."user_role") OR (("role" = 'coordinator'::"public"."user_role") AND "public"."is_coordinator_for_my_dept"("id"))));



CREATE POLICY "recurrence: all read" ON "public"."shift_recurrence_rules" FOR SELECT USING (true);



CREATE POLICY "recurrence: coord/admin manage" ON "public"."shift_recurrence_rules" USING ("public"."is_coordinator_or_admin"());



CREATE POLICY "reminders: admin read" ON "public"."confirmation_reminders" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "reminders: coord read" ON "public"."confirmation_reminders" FOR SELECT USING (("recipient_id" = "auth"."uid"()));



CREATE POLICY "reports: coord/admin insert" ON "public"."volunteer_shift_reports" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_coordinator_or_admin"());



CREATE POLICY "reports: volunteer own" ON "public"."volunteer_shift_reports" USING (("volunteer_id" = "auth"."uid"()));



CREATE POLICY "restrictions: admin all" ON "public"."department_restrictions" USING ("public"."is_admin"());



CREATE POLICY "restrictions: coordinator delete" ON "public"."department_restrictions" FOR DELETE USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."department_coordinators" "dc"
  WHERE (("dc"."department_id" = "department_restrictions"."department_id") AND ("dc"."coordinator_id" = "auth"."uid"()))))));



CREATE POLICY "restrictions: coordinator manage" ON "public"."department_restrictions" USING (("public"."is_coordinator_or_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."department_coordinators" "dc"
  WHERE (("dc"."department_id" = "department_restrictions"."department_id") AND ("dc"."coordinator_id" = "auth"."uid"()))))));



CREATE POLICY "restrictions: volunteer own read" ON "public"."department_restrictions" FOR SELECT USING (("volunteer_id" = "auth"."uid"()));



ALTER TABLE "public"."shift_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_booking_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_recurrence_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_time_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shift_time_slots: deny client delete" ON "public"."shift_time_slots" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "shift_time_slots: deny client insert" ON "public"."shift_time_slots" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "shift_time_slots: deny client update" ON "public"."shift_time_slots" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "shift_time_slots: read all" ON "public"."shift_time_slots" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shifts: admin delete" ON "public"."shifts" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "shifts: all read open" ON "public"."shifts" FOR SELECT USING ((("status" <> 'cancelled'::"public"."shift_status") AND ("public"."is_coordinator_or_admin"() OR (("shift_date" > CURRENT_DATE) OR (("shift_date" = CURRENT_DATE) AND (("start_time" IS NULL) OR (("start_time")::time with time zone > (CURRENT_TIME + '02:00:00'::interval))))))));



CREATE POLICY "shifts: coord delete cancelled" ON "public"."shifts" FOR DELETE USING (("public"."is_coordinator_or_admin"() AND ("status" = 'cancelled'::"public"."shift_status") AND (EXISTS ( SELECT 1
   FROM "public"."department_coordinators" "dc"
  WHERE (("dc"."department_id" = "shifts"."department_id") AND ("dc"."coordinator_id" = "auth"."uid"()))))));



CREATE POLICY "shifts: coord/admin insert" ON "public"."shifts" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("public"."is_coordinator_or_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."department_coordinators" "dc"
  WHERE (("dc"."department_id" = "shifts"."department_id") AND ("dc"."coordinator_id" = "auth"."uid"())))))));



CREATE POLICY "shifts: coord/admin update" ON "public"."shifts" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_coordinator_or_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."department_coordinators" "dc"
  WHERE (("dc"."department_id" = "shifts"."department_id") AND ("dc"."coordinator_id" = "auth"."uid"()))))))) WITH CHECK (("public"."is_admin"() OR ("public"."is_coordinator_or_admin"() AND (EXISTS ( SELECT 1
   FROM "public"."department_coordinators" "dc"
  WHERE (("dc"."department_id" = "shifts"."department_id") AND ("dc"."coordinator_id" = "auth"."uid"())))))));



CREATE POLICY "shifts: read booked" ON "public"."shifts" FOR SELECT TO "authenticated" USING ("public"."has_active_booking_on"("id"));



CREATE POLICY "time_slots: all read" ON "public"."shift_time_slots" FOR SELECT USING (true);



CREATE POLICY "time_slots: coord/admin write" ON "public"."shift_time_slots" USING ("public"."is_coordinator_or_admin"());



ALTER TABLE "public"."volunteer_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."volunteer_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."volunteer_private_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."volunteer_shift_interactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."volunteer_shift_reports" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_action_off_shift"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_action_off_shift"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_action_off_shift"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_break_glass_read_notes"("target_volunteer_id" "uuid", "reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_break_glass_read_notes"("target_volunteer_id" "uuid", "reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_break_glass_read_notes"("target_volunteer_id" "uuid", "reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_unactioned_shift"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_unactioned_shift"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_unactioned_shift"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_emergency_mfa_reset"("target_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_emergency_mfa_reset"("target_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_emergency_mfa_reset"("target_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_shift_hours"("p_booking_id" "uuid", "p_hours" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_shift_hours"("p_booking_id" "uuid", "p_hours" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_shift_hours"("p_booking_id" "uuid", "p_hours" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_bookings_on_profile_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_bookings_on_profile_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_bookings_on_profile_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cascade_bg_check_expiry"() TO "anon";
GRANT ALL ON FUNCTION "public"."cascade_bg_check_expiry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cascade_bg_check_expiry"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_attendance_dispute"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_attendance_dispute"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_attendance_dispute"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_notifications_for_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_for_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_for_booking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_notifications_for_shift"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_for_shift"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_notifications_for_shift"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_self_confirmation_report"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_self_confirmation_report"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_self_confirmation_report"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_admin_cap"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_admin_cap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_admin_cap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_booking_window"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_booking_window"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_booking_window"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_department_restriction"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_department_restriction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_department_restriction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_eligibility_on_profile_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_eligibility_on_profile_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_eligibility_on_profile_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_shift_not_ended_on_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_shift_not_ended_on_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_shift_not_ended_on_booking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_volunteer_only_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_volunteer_only_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_volunteer_only_booking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."export_critical_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."export_critical_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."export_critical_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_shift_time_slots"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_shift_time_slots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_shift_time_slots"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_email_by_username"("p_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_email_by_username"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_email_by_username"("p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_shift_consistency"("shift_uuids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_shift_consistency"("shift_uuids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_consistency"("shift_uuids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_shift_popularity"("shift_uuids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_shift_popularity"("shift_uuids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_popularity"("shift_uuids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_shift_rating_aggregates"("shift_uuids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_shift_rating_aggregates"("shift_uuids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shift_rating_aggregates"("shift_uuids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unactioned_shifts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unactioned_shifts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unactioned_shifts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unread_conversation_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unread_conversation_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unread_conversation_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_booking_on"("p_shift_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_booking_on"("p_shift_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_booking_on"("p_shift_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_coordinator_for_my_dept"("p_coordinator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_coordinator_for_my_dept"("p_coordinator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_coordinator_for_my_dept"("p_coordinator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_coordinator_or_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_coordinator_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_coordinator_or_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_mfa_reset"("target_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."log_mfa_reset"("target_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_mfa_reset"("target_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mfa_consume_backup_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mfa_consume_backup_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mfa_consume_backup_code"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mfa_generate_backup_codes"() TO "anon";
GRANT ALL ON FUNCTION "public"."mfa_generate_backup_codes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mfa_generate_backup_codes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mfa_unused_backup_code_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."mfa_unused_backup_code_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mfa_unused_backup_code_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notification_link_booking_id"("p_link" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."notification_link_booking_id"("p_link" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notification_link_booking_id"("p_link" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_email_on_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_email_on_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_email_on_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_overlapping_bookings"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_overlapping_bookings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_overlapping_bookings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_role_self_escalation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_role_self_escalation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_role_self_escalation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_confirmation_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_confirmation_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_confirmation_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid", "p_time_slot_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid", "p_time_slot_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_next_waitlist"("p_shift_id" "uuid", "p_time_slot_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_consistency"("p_volunteer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_consistency"("p_volunteer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_consistency"("p_volunteer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_points"("volunteer_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_points"("volunteer_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_points"("volunteer_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reconcile_shift_counters"() TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_shift_counters"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_shift_counters"() TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_hours_discrepancy"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_hours_discrepancy"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_hours_discrepancy"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."score_shifts_for_volunteer"("p_volunteer_id" "uuid", "p_max_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."score_shifts_for_volunteer"("p_volunteer_id" "uuid", "p_max_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."score_shifts_for_volunteer"("p_volunteer_id" "uuid", "p_max_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."send_self_confirmation_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."send_self_confirmation_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_self_confirmation_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."shift_end_at"("p_shift_date" "date", "p_end_time" time without time zone, "p_time_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."shift_end_at"("p_shift_date" "date", "p_end_time" time without time zone, "p_time_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shift_end_at"("p_shift_date" "date", "p_end_time" time without time zone, "p_time_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."shift_start_at"("p_shift_date" "date", "p_start_time" time without time zone, "p_time_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."shift_start_at"("p_shift_date" "date", "p_start_time" time without time zone, "p_time_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shift_start_at"("p_shift_date" "date", "p_start_time" time without time zone, "p_time_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_booked_slots"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_booked_slots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_booked_slots"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_is_minor"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_is_minor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_is_minor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_slot_booked_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_slot_booked_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_slot_booked_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_volunteer_reported_hours"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_volunteer_reported_hours"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_volunteer_reported_hours"() TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_admin_role"("from_admin_id" "uuid", "to_coordinator_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_admin_role"("from_admin_id" "uuid", "to_coordinator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_admin_role"("from_admin_id" "uuid", "to_coordinator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_coordinator_and_delete"("p_coordinator_id" "uuid", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_coordinator_and_delete"("p_coordinator_id" "uuid", "p_admin_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_coordinator_and_delete"("p_coordinator_id" "uuid", "p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recalc_consistency_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recalc_consistency_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalc_consistency_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recalculate_consistency_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recalculate_consistency_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalculate_consistency_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_recalculate_points_fn"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_recalculate_points_fn"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_recalculate_points_fn"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_update_preferences_on_interaction"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_update_preferences_on_interaction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_update_preferences_on_interaction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_waitlist_promote_on_cancel"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_waitlist_promote_on_cancel"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_waitlist_promote_on_cancel"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_waitlist_promote_on_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_waitlist_promote_on_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_waitlist_promote_on_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_shift_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_shift_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_shift_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_volunteer_preferences"("p_volunteer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_volunteer_preferences"("p_volunteer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_volunteer_preferences"("p_volunteer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."username_available"("p_username" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."username_available"("p_username" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."username_available"("p_username" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_booking_slot_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_booking_slot_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_booking_slot_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_checkin_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_checkin_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_checkin_token"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."waitlist_accept"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."waitlist_accept"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."waitlist_accept"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."waitlist_decline"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."waitlist_decline"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."waitlist_decline"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."warn_expiring_documents"() TO "anon";
GRANT ALL ON FUNCTION "public"."warn_expiring_documents"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."warn_expiring_documents"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_action_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_action_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_action_log" TO "service_role";



GRANT ALL ON TABLE "public"."admin_mfa_resets" TO "anon";
GRANT ALL ON TABLE "public"."admin_mfa_resets" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_mfa_resets" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_disputes" TO "anon";
GRANT ALL ON TABLE "public"."attendance_disputes" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_disputes" TO "service_role";



GRANT ALL ON TABLE "public"."checkin_tokens" TO "anon";
GRANT ALL ON TABLE "public"."checkin_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."checkin_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."confirmation_reminders" TO "anon";
GRANT ALL ON TABLE "public"."confirmation_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."confirmation_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_participants" TO "anon";
GRANT ALL ON TABLE "public"."conversation_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_participants" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."department_coordinators" TO "anon";
GRANT ALL ON TABLE "public"."department_coordinators" TO "authenticated";
GRANT ALL ON TABLE "public"."department_coordinators" TO "service_role";



GRANT ALL ON TABLE "public"."department_restrictions" TO "anon";
GRANT ALL ON TABLE "public"."department_restrictions" TO "authenticated";
GRANT ALL ON TABLE "public"."department_restrictions" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."document_types" TO "anon";
GRANT ALL ON TABLE "public"."document_types" TO "authenticated";
GRANT ALL ON TABLE "public"."document_types" TO "service_role";



GRANT ALL ON TABLE "public"."event_registrations" TO "anon";
GRANT ALL ON TABLE "public"."event_registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."event_registrations" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_backup_codes" TO "anon";
GRANT ALL ON TABLE "public"."mfa_backup_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."mfa_backup_codes" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."parental_consents" TO "anon";
GRANT ALL ON TABLE "public"."parental_consents" TO "authenticated";
GRANT ALL ON TABLE "public"."parental_consents" TO "service_role";



GRANT ALL ON TABLE "public"."private_note_access_log" TO "anon";
GRANT ALL ON TABLE "public"."private_note_access_log" TO "authenticated";
GRANT ALL ON TABLE "public"."private_note_access_log" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."shift_attachments" TO "anon";
GRANT ALL ON TABLE "public"."shift_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."shift_booking_slots" TO "anon";
GRANT ALL ON TABLE "public"."shift_booking_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_booking_slots" TO "service_role";



GRANT ALL ON TABLE "public"."shift_bookings" TO "anon";
GRANT ALL ON TABLE "public"."shift_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."shifts" TO "anon";
GRANT ALL ON TABLE "public"."shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."shifts" TO "service_role";



GRANT ALL ON TABLE "public"."shift_fill_rates" TO "anon";
GRANT ALL ON TABLE "public"."shift_fill_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_fill_rates" TO "service_role";



GRANT ALL ON TABLE "public"."shift_invitations" TO "anon";
GRANT ALL ON TABLE "public"."shift_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."shift_notes" TO "anon";
GRANT ALL ON TABLE "public"."shift_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_notes" TO "service_role";



GRANT ALL ON TABLE "public"."shift_recurrence_rules" TO "anon";
GRANT ALL ON TABLE "public"."shift_recurrence_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_recurrence_rules" TO "service_role";



GRANT ALL ON TABLE "public"."shift_time_slots" TO "anon";
GRANT ALL ON TABLE "public"."shift_time_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_time_slots" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_documents" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_documents" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_preferences" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_private_notes" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_private_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_private_notes" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_shift_interactions" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_shift_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_shift_interactions" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_shift_reports" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_shift_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_shift_reports" TO "service_role";



GRANT ALL ON TABLE "public"."volunteer_shift_reports_safe" TO "anon";
GRANT ALL ON TABLE "public"."volunteer_shift_reports_safe" TO "authenticated";
GRANT ALL ON TABLE "public"."volunteer_shift_reports_safe" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








-- =============================================================================
-- Storage buckets and policies (extracted from archived migrations)
-- From: 20260329164156_..._shift-attachments, 20260406_document_storage.sql
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('shift-attachments', 'shift-attachments', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('volunteer-documents', 'volunteer-documents', false)
ON CONFLICT (id) DO NOTHING;

-- shift-attachments bucket policies
CREATE POLICY "Users can upload their own attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'shift-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read their own attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'shift-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Coordinators and admins can read all attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'shift-attachments' AND public.is_coordinator_or_admin());

-- volunteer-documents bucket policies
CREATE POLICY "Volunteers upload own docs to storage"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'volunteer-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Volunteers read own docs from storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'volunteer-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Coordinators and admins read all docs from storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'volunteer-documents' AND public.is_coordinator_or_admin());

CREATE POLICY "Volunteers delete own docs from storage"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'volunteer-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
