-- Allow volunteers to insert notifications (for self-reported no-show alerts)
CREATE POLICY "notifications: volunteer self insert"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'volunteer'
  )
);