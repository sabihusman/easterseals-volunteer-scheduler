import { describe, it, expect } from "vitest";
import { resolveOtherParticipants } from "@/lib/conversation-participants";

/**
 * Resolver unit tests. The audit-driven case is the FIRST one below:
 * a self-created conversation with no replies, where paths 1 + 2
 * leave it unresolved and only path 3 (RPC) can identify the
 * recipient. Pre-PR this case rendered as "Unknown" in the
 * conversation list.
 */

const ME = "user-self";
const COORD = "user-coord";
const VOL2 = "user-vol2";

describe("resolveOtherParticipants", () => {
  it("audit case: self-created conversation with no replies → resolves via RPC (path 3)", () => {
    // Volunteer just created this conversation. No messages yet AND
    // they are the creator. Without path 3 the recipient is invisible.
    const result = resolveOtherParticipants({
      callerId: ME,
      conversations: [{ id: "c1", created_by: ME }],
      messages: [],
      rpcParticipants: [{ conversation_id: "c1", user_id: COORD }],
    });

    expect(result.convoToOthers).toEqual({ c1: COORD });
    expect(result.otherUserIds).toEqual([COORD]);
  });

  it("baseline: inbound message resolves the recipient via path 1", () => {
    const result = resolveOtherParticipants({
      callerId: ME,
      conversations: [{ id: "c1", created_by: COORD }],
      messages: [
        { conversation_id: "c1", sender_id: COORD },
        { conversation_id: "c1", sender_id: ME },
      ],
      rpcParticipants: [],
    });

    expect(result.convoToOthers).toEqual({ c1: COORD });
    expect(result.otherUserIds).toEqual([COORD]);
  });

  it("path 2: someone else created the conversation but has not sent a message yet", () => {
    const result = resolveOtherParticipants({
      callerId: ME,
      conversations: [{ id: "c1", created_by: COORD }],
      messages: [],
      rpcParticipants: [],
    });

    expect(result.convoToOthers).toEqual({ c1: COORD });
    expect(result.otherUserIds).toEqual([COORD]);
  });

  it("path 1 wins over path 2 when both have an answer (cheaper to render)", () => {
    // Both paths agree on the same user. The path-1 entry is processed
    // first; the path-2 entry must NOT overwrite or duplicate.
    const result = resolveOtherParticipants({
      callerId: ME,
      conversations: [{ id: "c1", created_by: COORD }],
      messages: [{ conversation_id: "c1", sender_id: COORD }],
      rpcParticipants: [{ conversation_id: "c1", user_id: COORD }],
    });

    expect(result.convoToOthers).toEqual({ c1: COORD });
    // Crucially, COORD appears only once in otherUserIds.
    expect(result.otherUserIds).toEqual([COORD]);
  });

  it("never includes the caller's own id as the 'other' participant", () => {
    // Even with the caller appearing in messages.sender_id and the
    // RPC echoing them back, the resolver must skip them.
    const result = resolveOtherParticipants({
      callerId: ME,
      conversations: [{ id: "c1", created_by: ME }],
      messages: [{ conversation_id: "c1", sender_id: ME }],
      rpcParticipants: [
        { conversation_id: "c1", user_id: COORD },
        // RPC won't actually return this row in production, but the
        // resolver shouldn't trust the input.
      ],
    });

    expect(result.convoToOthers).toEqual({ c1: COORD });
    expect(result.otherUserIds).not.toContain(ME);
  });

  it("multiple conversations, mixed paths, all resolved", () => {
    const result = resolveOtherParticipants({
      callerId: ME,
      conversations: [
        { id: "c1", created_by: ME },     // self-created → needs RPC
        { id: "c2", created_by: COORD },  // someone else created
        { id: "c3", created_by: ME },     // self-created with replies
      ],
      messages: [
        { conversation_id: "c3", sender_id: VOL2 },
      ],
      rpcParticipants: [
        { conversation_id: "c1", user_id: COORD },
        // c2 doesn't need backfill; c3 already has a path-1 answer.
      ],
    });

    expect(result.convoToOthers).toEqual({
      c1: COORD,
      c2: COORD,
      c3: VOL2,
    });
    expect(result.otherUserIds).toEqual(
      expect.arrayContaining([COORD, VOL2]),
    );
    expect(result.otherUserIds).toHaveLength(2);
  });

  it("returns empty maps when no inputs resolve to a non-self id", () => {
    const result = resolveOtherParticipants({
      callerId: ME,
      conversations: [{ id: "c1", created_by: ME }],
      messages: [{ conversation_id: "c1", sender_id: ME }],
      rpcParticipants: [],
    });

    expect(result.convoToOthers).toEqual({});
    expect(result.otherUserIds).toEqual([]);
  });
});
