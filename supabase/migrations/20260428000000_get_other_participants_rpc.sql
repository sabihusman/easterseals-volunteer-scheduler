-- Audit 2026-04-28: ConversationList.tsx surfaces the recipient as
-- "Unknown" the first time a volunteer messages a coordinator. The
-- frontend reverse-engineers "the other participant" from
-- `messages.sender_id` and `conversations.created_by` because the
-- per-row RLS on `conversation_participants` (`Users read own
-- participations`) returns only the calling user's own row — there's
-- no path to the recipient until they reply.
--
-- This migration adds a SECURITY DEFINER RPC that returns
-- (conversation_id, user_id) for the OTHER participants in any
-- conversation the caller is also a participant of. The function
-- enforces caller-membership inside the body so SECURITY DEFINER does
-- not become a way to enumerate arbitrary conversations' participants.
--
-- Frontend uses this as a third resolution path inside
-- `ConversationList.fetchConversations()`. RLS on `profiles` is
-- unchanged; the existing `profiles: volunteer read admins and dept
-- coordinators` policy already permits the subsequent profile lookup
-- for the user IDs this RPC returns.

CREATE OR REPLACE FUNCTION "public"."get_other_participants"(
  "p_conversation_ids" uuid[]
)
RETURNS TABLE ("conversation_id" uuid, "user_id" uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Caller-membership filter: only return rows for conversations
  -- where the caller is themselves a participant. Without this clause
  -- a volunteer could pass any conversation_id and learn its members.
  -- The SECURITY DEFINER context bypasses the participants RLS, so
  -- the WHERE EXISTS check is the only authorization layer.
  SELECT cp_other.conversation_id, cp_other.user_id
  FROM public.conversation_participants cp_other
  WHERE cp_other.conversation_id = ANY(p_conversation_ids)
    AND cp_other.user_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversation_participants cp_self
      WHERE cp_self.conversation_id = cp_other.conversation_id
        AND cp_self.user_id = auth.uid()
    );
$$;

ALTER FUNCTION "public"."get_other_participants"(uuid[]) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_other_participants"(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."get_other_participants"(uuid[]) TO "authenticated";
-- Service role intentionally also gets execute for the RLS test
-- harness (which can call as service role to verify the function's
-- caller-membership logic with a known auth.uid()).
GRANT EXECUTE ON FUNCTION "public"."get_other_participants"(uuid[]) TO "service_role";

COMMENT ON FUNCTION "public"."get_other_participants"(uuid[]) IS
  'Returns (conversation_id, user_id) for participants OTHER than the caller in conversations the caller is a member of. SECURITY DEFINER bypasses the per-row RLS on conversation_participants (which only exposes the caller''s own row); the EXISTS clause inside the body re-applies the membership check so the function cannot be used to enumerate arbitrary conversations'' members. Used by ConversationList.fetchConversations to resolve the recipient display name on a freshly-created conversation pending the first reply.';
