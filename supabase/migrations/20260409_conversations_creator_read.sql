-- =============================================
-- Fix: "new row violates row-level security policy for table
-- conversations" when a volunteer (or any non-admin) tries to send
-- their first message to someone.
--
-- Root cause: ComposeMessage.tsx inserts the conversation row, then
-- separately inserts the participant rows. With
-- `.insert(...).select().single()`, PostgREST uses
-- INSERT ... RETURNING, which requires the new row to pass BOTH:
--   * the INSERT WITH CHECK policy (passes — created_by = auth.uid())
--   * the SELECT USING policy on the returned row
--
-- The existing SELECT policy "Participants read conversations" only
-- allows EXISTS(conversation_participants ...), but the participants
-- haven't been inserted yet at the moment of RETURNING. So the
-- creator can't read their own freshly-inserted conversation, and
-- Postgres reports it as a WITH CHECK violation.
--
-- Fix: let the creator read conversations they created.
-- =============================================

DROP POLICY IF EXISTS "Participants read conversations" ON public.conversations;

CREATE POLICY "Participants read conversations"
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_participants.conversation_id = conversations.id
        AND conversation_participants.user_id = auth.uid()
    )
    OR public.is_admin()
  );
