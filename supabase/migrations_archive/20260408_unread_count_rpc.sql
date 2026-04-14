-- =============================================
-- Consolidate the unread-message count into a single RPC.
-- Previously useUnreadCount made one HEAD count request PER
-- conversation, flooding the PostgREST pooler. With several
-- conversations in the system this routinely caused 503s.
--
-- Single round-trip version: counts distinct conversations where
-- the user has at least one message from someone else newer than
-- the later of last_read_at and cleared_at.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_unread_conversation_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.get_unread_conversation_count() TO authenticated;
