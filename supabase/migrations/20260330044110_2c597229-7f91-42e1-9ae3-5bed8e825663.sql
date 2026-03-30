CREATE POLICY "booking_slots: volunteer delete own"
ON public.shift_booking_slots
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM shift_bookings sb
    WHERE sb.id = shift_booking_slots.booking_id
    AND sb.volunteer_id = auth.uid()
  )
);