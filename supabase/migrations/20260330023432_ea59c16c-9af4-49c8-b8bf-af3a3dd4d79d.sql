-- Fix search_path on all public functions to prevent search path injection

ALTER FUNCTION public.sync_slot_booked_count() SET search_path = public;
ALTER FUNCTION public.generate_shift_time_slots() SET search_path = public;
ALTER FUNCTION public.enforce_volunteer_only_booking() SET search_path = public;
ALTER FUNCTION public.enforce_admin_cap() SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.update_shift_status() SET search_path = public;
ALTER FUNCTION public.sync_booked_slots() SET search_path = public;
ALTER FUNCTION public.enforce_booking_window() SET search_path = public;
ALTER FUNCTION public.recalculate_consistency(uuid) SET search_path = public;
ALTER FUNCTION public.trg_recalc_consistency_fn() SET search_path = public;
ALTER FUNCTION public.process_confirmation_reminders() SET search_path = public;
ALTER FUNCTION public.my_role() SET search_path = public;
ALTER FUNCTION public.is_admin() SET search_path = public;
ALTER FUNCTION public.is_coordinator_or_admin() SET search_path = public;
ALTER FUNCTION public.transfer_admin_role(uuid, uuid) SET search_path = public;