-- Backfill shift_time_slots for existing shifts that have start_time and end_time
DO $$
DECLARE
  rec RECORD;
  slot_s time;
  slot_e time;
BEGIN
  FOR rec IN
    SELECT id, start_time, end_time, total_slots
    FROM public.shifts
    WHERE start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.shift_time_slots WHERE shift_id = shifts.id)
  LOOP
    slot_s := rec.start_time;
    WHILE slot_s < rec.end_time LOOP
      slot_e := LEAST(slot_s + interval '2 hours', rec.end_time);
      INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
      VALUES (rec.id, slot_s, slot_e, rec.total_slots);
      slot_s := slot_e;
    END LOOP;
  END LOOP;
END;
$$;