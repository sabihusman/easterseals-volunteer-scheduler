-- =============================================
-- Minor volunteer waivers & age verification.
--
-- Easterseals Johnston accepts volunteers under 18. Digital
-- parental consent must be on file before minors can book shifts.
-- =============================================

-- ── 1. Date of birth + is_minor on profiles ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date;

-- Generated column: true when the volunteer is under 18.
-- PostgreSQL GENERATED ALWAYS AS requires the expression to be
-- immutable. age() is stable (depends on current_date), so we
-- use a workaround: store is_minor as a regular column and
-- update it via trigger instead.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_minor boolean NOT NULL DEFAULT false;

-- Trigger to keep is_minor in sync with date_of_birth.
CREATE OR REPLACE FUNCTION public.sync_is_minor()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.is_minor := (
    NEW.date_of_birth IS NOT NULL
    AND age(NEW.date_of_birth) < interval '18 years'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_is_minor ON public.profiles;
CREATE TRIGGER trg_sync_is_minor
  BEFORE INSERT OR UPDATE OF date_of_birth ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_is_minor();

-- ── 2. Parental consents table ──
CREATE TABLE IF NOT EXISTS public.parental_consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_name      text NOT NULL,
  parent_email     text NOT NULL,
  parent_phone     text,
  consent_given_at timestamptz DEFAULT now(),
  consent_method   text NOT NULL DEFAULT 'digital',
  expires_at       timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parental_consents ENABLE ROW LEVEL SECURITY;

-- Volunteers read their own
DROP POLICY IF EXISTS "consent: volunteer own read" ON public.parental_consents;
CREATE POLICY "consent: volunteer own read"
  ON public.parental_consents
  FOR SELECT
  TO authenticated
  USING (volunteer_id = auth.uid());

-- Volunteers can insert their own (digital consent form)
DROP POLICY IF EXISTS "consent: volunteer own insert" ON public.parental_consents;
CREATE POLICY "consent: volunteer own insert"
  ON public.parental_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (volunteer_id = auth.uid());

-- Admins full access
DROP POLICY IF EXISTS "consent: admin all" ON public.parental_consents;
CREATE POLICY "consent: admin all"
  ON public.parental_consents
  FOR ALL
  TO authenticated
  USING (public.is_admin());

-- Coordinators read for their department's volunteers
DROP POLICY IF EXISTS "consent: coordinator read" ON public.parental_consents;
CREATE POLICY "consent: coordinator read"
  ON public.parental_consents
  FOR SELECT
  TO authenticated
  USING (
    public.is_coordinator_or_admin()
    AND EXISTS (
      SELECT 1 FROM public.shift_bookings sb
      JOIN public.shifts s ON s.id = sb.shift_id
      JOIN public.department_coordinators dc ON dc.department_id = s.department_id
      WHERE sb.volunteer_id = parental_consents.volunteer_id
        AND dc.coordinator_id = auth.uid()
    )
  );

-- ── 3. Booking gate for minors ──
-- Add the check to enforce_booking_window (which already runs
-- BEFORE INSERT on shift_bookings). We recreate the full function
-- to add the minor consent check after the emergency contact check.

CREATE OR REPLACE FUNCTION public.enforce_booking_window()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
$function$;
