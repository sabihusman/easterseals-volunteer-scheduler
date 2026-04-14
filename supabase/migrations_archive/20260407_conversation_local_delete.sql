-- =============================================
-- Local (per-user) conversation deletion
-- When a user "deletes" a conversation, we only hide it
-- for them by setting cleared_at on their participant row.
-- Other participants are unaffected.
-- If a new message is sent afterwards (created_at > cleared_at),
-- the conversation reappears for that user with only the new
-- messages visible.
-- =============================================
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

CREATE INDEX IF NOT EXISTS conversation_participants_cleared_at_idx
  ON public.conversation_participants (user_id, cleared_at);
