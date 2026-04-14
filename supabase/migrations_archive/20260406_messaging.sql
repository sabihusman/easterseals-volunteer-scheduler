-- =============================================
-- FULL TWO-WAY MESSAGING SYSTEM
-- Migration: 2026-04-06
-- =============================================

-- ── CONVERSATIONS ──
CREATE TABLE public.conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject           text,
  conversation_type text NOT NULL DEFAULT 'direct'
                      CHECK (conversation_type IN ('direct','bulk')),
  department_id     uuid REFERENCES public.departments(id),
  created_by        uuid NOT NULL REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- ── CONVERSATION PARTICIPANTS ──
CREATE TABLE public.conversation_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false,
  UNIQUE(conversation_id, user_id)
);

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- ── MESSAGES ──
CREATE TABLE public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES public.profiles(id),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════
-- RLS POLICIES
-- ══════════════════════════════════════

-- Conversations: participants + admins can read
CREATE POLICY "Participants read conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = conversations.id AND user_id = auth.uid()
    )
    OR public.is_admin()
  );

-- Conversations: any authenticated user can create
CREATE POLICY "Authenticated users create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Conversations: participants/admins can update (updated_at)
CREATE POLICY "Participants update conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = conversations.id AND user_id = auth.uid()
    )
    OR public.is_admin()
  );

-- Participants: read own + admins read all
CREATE POLICY "Users read own participations"
  ON public.conversation_participants FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Participants: read all participants of conversations you're in
CREATE POLICY "Participants read co-participants"
  ON public.conversation_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_participants.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

-- Participants: creator/coordinator/admin can add
CREATE POLICY "Creator or staff adds participants"
  ON public.conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = conversation_id AND created_by = auth.uid()
    )
    OR public.is_coordinator_or_admin()
  );

-- Participants: users update own (last_read_at, is_archived)
CREATE POLICY "Users update own participation"
  ON public.conversation_participants FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Messages: participants + admins can read
CREATE POLICY "Participants read messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
    OR public.is_admin()
  );

-- Messages: participants can send
CREATE POLICY "Participants send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
  );

-- ══════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════
CREATE INDEX idx_conversation_participants_user
  ON public.conversation_participants(user_id);
CREATE INDEX idx_conversation_participants_convo
  ON public.conversation_participants(conversation_id);
CREATE INDEX idx_messages_conversation
  ON public.messages(conversation_id, created_at);
CREATE INDEX idx_messages_sender
  ON public.messages(sender_id);

-- ══════════════════════════════════════
-- ENABLE REALTIME ON MESSAGES
-- ══════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
