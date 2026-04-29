/**
 * Resolve the "other participant" of each conversation in a list, for
 * the conversation-list left-rail rendering. Pure: takes the data the
 * three resolution paths produce and returns the join map; the React
 * component owns the actual fetches.
 *
 * Three resolution paths run in order; each only resolves
 * conversations not already resolved by an earlier path:
 *
 *   1. messages.sender_id where it isn't the caller (covers any
 *      conversation that has at least one inbound message).
 *   2. conversations.created_by where it isn't the caller (covers
 *      conversations someone else started but hasn't sent a message
 *      body in yet).
 *   3. get_other_participants RPC results (covers conversations the
 *      caller themselves created, where the recipient hasn't replied
 *      yet — the audit 2026-04-28 case that surfaced as "Unknown").
 *
 * The function returns BOTH the per-conversation map and a
 * de-duplicated list of user IDs to fetch profiles for. Callers use
 * the list to issue a single `profiles?in=` query.
 */

export interface MessageRow {
  conversation_id: string;
  sender_id: string;
}

export interface ConversationCreator {
  id: string;
  created_by: string;
}

export interface ParticipantRow {
  conversation_id: string;
  user_id: string;
}

export interface ResolvedParticipants {
  /** conversation_id → user_id of the other participant */
  convoToOthers: Record<string, string>;
  /** De-duplicated list, in first-seen order, for the profiles fetch. */
  otherUserIds: string[];
}

export function resolveOtherParticipants(args: {
  callerId: string;
  conversations: ConversationCreator[];
  messages: MessageRow[];
  /** RPC backfill rows. Only conversations still unresolved after
   *  paths 1+2 are queried; the helper assumes the caller already
   *  filtered the input set, but it's idempotent regardless. */
  rpcParticipants: ParticipantRow[];
}): ResolvedParticipants {
  const { callerId, conversations, messages, rpcParticipants } = args;
  const convoToOthers: Record<string, string> = {};
  const otherUserIds: string[] = [];

  const note = (convoId: string, userId: string) => {
    if (!convoToOthers[convoId]) convoToOthers[convoId] = userId;
    if (!otherUserIds.includes(userId)) otherUserIds.push(userId);
  };

  // Path 1 — messages
  for (const m of messages) {
    if (m.sender_id !== callerId && !convoToOthers[m.conversation_id]) {
      note(m.conversation_id, m.sender_id);
    }
  }

  // Path 2 — created_by
  for (const c of conversations) {
    if (c.created_by !== callerId && !convoToOthers[c.id]) {
      note(c.id, c.created_by);
    }
  }

  // Path 3 — RPC backfill
  for (const r of rpcParticipants) {
    if (!convoToOthers[r.conversation_id]) {
      note(r.conversation_id, r.user_id);
    }
  }

  return { convoToOthers, otherUserIds };
}
