
-- Create storage bucket for shift attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('shift-attachments', 'shift-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for the bucket
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
