-- =============================================
-- FIX: Allow deleting shifts even when they have
-- recurring children or bookings
-- =============================================

-- Drop the existing self-referencing FK on shifts.recurrence_parent
ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_recurrence_parent_fkey;

-- Recreate with ON DELETE SET NULL so deleting a parent
-- doesn't break child instances; they just become standalone shifts
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_recurrence_parent_fkey
  FOREIGN KEY (recurrence_parent)
  REFERENCES public.shifts(id)
  ON DELETE SET NULL;

-- Drop and recreate shift_bookings.shift_id FK with cascade
-- so deleting a shift also removes its bookings (instead of blocking)
ALTER TABLE public.shift_bookings
  DROP CONSTRAINT IF EXISTS shift_bookings_shift_id_fkey;

ALTER TABLE public.shift_bookings
  ADD CONSTRAINT shift_bookings_shift_id_fkey
  FOREIGN KEY (shift_id)
  REFERENCES public.shifts(id)
  ON DELETE CASCADE;

-- Same for shift_time_slots
ALTER TABLE public.shift_time_slots
  DROP CONSTRAINT IF EXISTS shift_time_slots_shift_id_fkey;

ALTER TABLE public.shift_time_slots
  ADD CONSTRAINT shift_time_slots_shift_id_fkey
  FOREIGN KEY (shift_id)
  REFERENCES public.shifts(id)
  ON DELETE CASCADE;

-- And volunteer_shift_interactions
ALTER TABLE public.volunteer_shift_interactions
  DROP CONSTRAINT IF EXISTS volunteer_shift_interactions_shift_id_fkey;

ALTER TABLE public.volunteer_shift_interactions
  ADD CONSTRAINT volunteer_shift_interactions_shift_id_fkey
  FOREIGN KEY (shift_id)
  REFERENCES public.shifts(id)
  ON DELETE CASCADE;
