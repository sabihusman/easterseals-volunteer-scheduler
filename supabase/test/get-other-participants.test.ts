import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInAs, adminBypassClient, getHarnessUsers } from "./clients";

/**
 * Coverage for the `get_other_participants` SECURITY DEFINER RPC
 * introduced in `20260428000000_get_other_participants_rpc.sql`.
 *
 * The RPC's job is to let a caller resolve the OTHER participants in
 * conversations the caller is a member of, working around the per-row
 * RLS on `conversation_participants` ("Users read own participations")
 * that hides the recipient's row from the caller.
 *
 * Two safety properties to pin:
 *
 *   1. Callers see other participants ONLY for conversations they
 *      themselves are members of.
 *   2. Callers do NOT see participants for conversations they aren't
 *      members of, even if they pass the conversation_id explicitly.
 *
 * Property #2 is what prevents the SECURITY DEFINER bypass from
 * becoming a participant-enumeration vector.
 */

let convoVolunteerCoord: string; // volunteer ↔ coordinator
let convoVolunteer2Coord: string; // volunteer2 ↔ coordinator (volunteer is NOT a member)

beforeAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();

  // Conversation 1: volunteer ↔ coordinator (the typical "fresh send"
  // case from the audit — created by the volunteer, no replies yet).
  const { data: c1, error: c1Err } = await admin
    .from("conversations")
    .insert({
      created_by: users.volunteer.id,
      conversation_type: "direct",
      subject: "Audit ping (test)",
    } as never)
    .select("id")
    .single();
  if (c1Err) throw new Error(`convo1 insert: ${c1Err.message}`);
  convoVolunteerCoord = (c1 as { id: string }).id;

  await admin.from("conversation_participants").insert([
    { conversation_id: convoVolunteerCoord, user_id: users.volunteer.id },
    { conversation_id: convoVolunteerCoord, user_id: users.coordinator.id },
  ] as never);

  // Conversation 2: volunteer2 ↔ coordinator. The first volunteer is
  // not a member — used to prove property #2.
  const { data: c2, error: c2Err } = await admin
    .from("conversations")
    .insert({
      created_by: users.volunteer2.id,
      conversation_type: "direct",
      subject: "Other thread (test)",
    } as never)
    .select("id")
    .single();
  if (c2Err) throw new Error(`convo2 insert: ${c2Err.message}`);
  convoVolunteer2Coord = (c2 as { id: string }).id;

  await admin.from("conversation_participants").insert([
    { conversation_id: convoVolunteer2Coord, user_id: users.volunteer2.id },
    { conversation_id: convoVolunteer2Coord, user_id: users.coordinator.id },
  ] as never);
});

afterAll(async () => {
  const admin = adminBypassClient();
  const ids = [convoVolunteerCoord, convoVolunteer2Coord];
  await admin.from("conversation_participants").delete().in("conversation_id", ids);
  await admin.from("conversations").delete().in("id", ids);
});

describe("get_other_participants RPC", () => {
  it("returns the coordinator for a conversation the volunteer is a member of", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");

    const { data, error } = await client.rpc("get_other_participants", {
      p_conversation_ids: [convoVolunteerCoord],
    });

    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ conversation_id: string; user_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].conversation_id).toBe(convoVolunteerCoord);
    expect(rows[0].user_id).toBe(users.coordinator.id);
  });

  it("does NOT return the volunteer's own user_id", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");

    const { data } = await client.rpc("get_other_participants", {
      p_conversation_ids: [convoVolunteerCoord],
    });

    const rows = (data ?? []) as Array<{ conversation_id: string; user_id: string }>;
    for (const row of rows) {
      expect(row.user_id).not.toBe(users.volunteer.id);
    }
  });

  it("does NOT leak participants of a conversation the caller isn't a member of", async () => {
    // The volunteer is NOT a member of convoVolunteer2Coord. Even if
    // they pass the conversation_id explicitly, the RPC's EXISTS
    // clause should filter out the row. This is the
    // SECURITY-DEFINER-bypass guard.
    const client = await signInAs("volunteer");

    const { data, error } = await client.rpc("get_other_participants", {
      p_conversation_ids: [convoVolunteer2Coord],
    });

    expect(error).toBeNull();
    expect((data ?? []) as unknown[]).toEqual([]);
  });

  it("filters per-row when the input mixes member + non-member conversation ids", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");

    const { data } = await client.rpc("get_other_participants", {
      p_conversation_ids: [convoVolunteerCoord, convoVolunteer2Coord],
    });

    const rows = (data ?? []) as Array<{ conversation_id: string; user_id: string }>;
    // Exactly one row — the volunteer's own conversation. The
    // volunteer2's conversation must be filtered, even though it was
    // in the input.
    expect(rows).toHaveLength(1);
    expect(rows[0].conversation_id).toBe(convoVolunteerCoord);
    expect(rows[0].user_id).toBe(users.coordinator.id);
  });

  it("coordinator side: same RPC resolves the volunteer for the same conversation", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("coordinator");

    const { data } = await client.rpc("get_other_participants", {
      p_conversation_ids: [convoVolunteerCoord],
    });

    const rows = (data ?? []) as Array<{ conversation_id: string; user_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(users.volunteer.id);
  });
});
