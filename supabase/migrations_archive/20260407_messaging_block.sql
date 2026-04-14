-- =============================================
-- Admin-controlled messaging block
-- When messaging_blocked = true on a profile, the user cannot
-- SEND messages or CREATE new conversations/participants.
-- They can still READ (so they can see replies from admins).
-- =============================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS messaging_blocked boolean NOT NULL DEFAULT false;

-- Update the messages INSERT policy to deny blocked users
DROP POLICY IF EXISTS "Participants send messages" ON public.messages;
CREATE POLICY "Participants send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND messaging_blocked = true
    )
  );

-- Also deny blocked users from creating new conversations
DROP POLICY IF EXISTS "Authenticated users create conversations" ON public.conversations;
CREATE POLICY "Authenticated users create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND messaging_blocked = true
    )
  );
