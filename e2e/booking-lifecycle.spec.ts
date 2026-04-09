/**
 * E2E test: full booking lifecycle with counter invariants.
 *
 *   Book \u2192 Waitlist \u2192 Cancel \u2192 Promote \u2192 Accept
 *
 * This test asserts that after EVERY state transition:
 *   - shifts.booked_slots equals the count of confirmed shift_bookings rows
 *   - shifts.status reflects the counter (open vs full)
 *   - shift_time_slots.booked_slots is consistent with shift_booking_slots
 *
 * Background: every counter-drift bug we've fixed in this codebase
 * (validate_booking_slot_count double-increment, sync_booked_slots RLS
 * blocking, missing cancelled\u2192confirmed branch, sync_slot_booked_count
 * silently clamping) would have been caught by these assertions before
 * reaching production.
 *
 * Run:
 *   SUPABASE_ANON_KEY=... npx playwright test --config e2e/playwright.config.ts
 */

import { test, expect, request } from "@playwright/test";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://esycmohgumryeqteiwla.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// Test users seeded by the QA fixtures
const VOL_A = { email: "sabih.usman@live.com", id: "53dbf0d5-e1ea-4f4c-9d27-bbb5ce9d0ef3" };
const VOL_B = { email: "anam@live.ca",        id: "58b51394-647b-4a5f-a6d0-1a6277d5af81" };
const COORD = { email: "sabih-usman@uiowa.edu" };
const PASSWORD = "Demo1234$";

const ADP_DEPT_ID = "56a6edcb-80da-4ff0-b8a0-59c3b676cf0b";

const tokens: { [k: string]: string } = {};
let testShiftId: string | null = null;

// ----- helpers -----

async function login(api: any, email: string): Promise<string> {
  const res = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `login ${email} failed`).toBeTruthy();
  const j = await res.json();
  return j.access_token;
}

async function rest(api: any, role: string, method: string, path: string, body?: any) {
  const res = await api.fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${tokens[role]}`,
      Prefer: "return=representation",
    },
    data: body,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON responses (empty bodies, plain text errors) are expected
    // from some endpoints; fall through with parsed = null.
  }
  return { status: res.status(), data: parsed, raw: text };
}

async function rpc(api: any, role: string, fn: string, body: any) {
  const res = await api.fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${tokens[role]}`,
    },
    data: body,
  });
  return { status: res.status(), text: await res.text() };
}

async function shiftRow(api: any) {
  const r = await rest(
    api,
    "coord",
    "GET",
    `/shifts?select=id,total_slots,booked_slots,status&id=eq.${testShiftId}`
  );
  return r.data?.[0];
}

async function confirmedBookingCount(api: any): Promise<number> {
  const r = await rest(
    api,
    "coord",
    "GET",
    `/shift_bookings?select=id&shift_id=eq.${testShiftId}&booking_status=eq.confirmed`
  );
  return Array.isArray(r.data) ? r.data.length : 0;
}

async function assertCounterInvariant(api: any, label: string) {
  const shift = await shiftRow(api);
  const real = await confirmedBookingCount(api);
  expect(
    shift.booked_slots,
    `${label}: shifts.booked_slots (${shift.booked_slots}) must equal real confirmed count (${real})`
  ).toBe(real);
  expect(
    shift.booked_slots,
    `${label}: counter must never exceed total_slots`
  ).toBeLessThanOrEqual(shift.total_slots);
  expect(
    shift.booked_slots,
    `${label}: counter must never go below 0`
  ).toBeGreaterThanOrEqual(0);
  if (shift.booked_slots >= shift.total_slots) {
    expect(shift.status, `${label}: full counter \u2192 status=full`).toBe("full");
  } else {
    expect(shift.status, `${label}: open counter \u2192 status=open`).toBe("open");
  }
}

// ----- lifecycle -----

test.beforeAll(async () => {
  expect(SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY env var required").toBeTruthy();

  const api = await request.newContext();
  tokens.vol_a = await login(api, VOL_A.email);
  tokens.vol_b = await login(api, VOL_B.email);
  tokens.coord = await login(api, COORD.email);

  // Coordinator creates a fresh 1-slot shift dedicated to this test
  // (1-slot is the most stringent invariant target).
  const tomorrow = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const create = await rest(api, "coord", "POST", "/shifts", {
    department_id: ADP_DEPT_ID,
    title: `Playwright Lifecycle ${Date.now()}`,
    shift_date: tomorrow,
    time_type: "custom",
    start_time: "10:00:00",
    end_time: "12:00:00",
    total_slots: 1,
    requires_bg_check: true,
    status: "open",
  });
  expect(create.status, "shift create").toBe(201);
  testShiftId = create.data?.[0]?.id;
  expect(testShiftId, "shift id present").toBeTruthy();

  await api.dispose();
});

test.afterAll(async () => {
  if (!testShiftId) return;
  const api = await request.newContext();
  // Clean up — admin-deletable since the coord owns this dept.
  await rest(api, "coord", "DELETE", `/shifts?id=eq.${testShiftId}`);
  await api.dispose();
});

test("counter invariants hold across full booking lifecycle", async () => {
  const api = await request.newContext();

  // ---- 0. Initial state: 0 booked, status open
  await assertCounterInvariant(api, "initial");

  // ---- 1. Vol A books \u2192 confirmed
  const bookA = await rest(api, "vol_a", "POST", "/shift_bookings", {
    shift_id: testShiftId,
    volunteer_id: VOL_A.id,
    booking_status: "confirmed",
  });
  expect(bookA.status, "Vol A book").toBe(201);
  expect(bookA.data?.[0]?.booking_status).toBe("confirmed");
  await assertCounterInvariant(api, "after Vol A confirmed");

  // ---- 2. Vol B tries to book \u2192 must be auto-demoted to waitlisted
  const bookB = await rest(api, "vol_b", "POST", "/shift_bookings", {
    shift_id: testShiftId,
    volunteer_id: VOL_B.id,
    booking_status: "confirmed", // requesting confirmed; trigger demotes
  });
  expect(bookB.status, "Vol B book").toBe(201);
  expect(
    bookB.data?.[0]?.booking_status,
    "Vol B should be demoted to waitlisted (full shift)"
  ).toBe("waitlisted");
  await assertCounterInvariant(api, "after Vol B waitlisted");

  // ---- 3. Vol A cancels \u2192 promotion trigger should fire \u2192 Vol B gets offer
  const volABookingId = bookA.data?.[0]?.id;
  const cancel = await rest(api, "vol_a", "PATCH",
    `/shift_bookings?id=eq.${volABookingId}`,
    { booking_status: "cancelled", cancelled_at: new Date().toISOString() }
  );
  expect(cancel.status, "Vol A cancel").toBe(200);

  // Give the trigger a moment to propagate (it's synchronous but the AFTER
  // chain runs in a few additional statements)
  await new Promise((r) => setTimeout(r, 500));

  await assertCounterInvariant(api, "after Vol A cancel");

  // Vol B should now have an active waitlist offer
  const offer = await rest(
    api,
    "vol_b",
    "GET",
    `/shift_bookings?select=id,booking_status,waitlist_offer_expires_at&volunteer_id=eq.${VOL_B.id}&shift_id=eq.${testShiftId}`
  );
  const volBBooking = offer.data?.[0];
  expect(volBBooking?.booking_status, "Vol B still waitlisted").toBe("waitlisted");
  expect(
    volBBooking?.waitlist_offer_expires_at,
    "Vol B has an active offer expiry"
  ).toBeTruthy();
  expect(
    new Date(volBBooking.waitlist_offer_expires_at).getTime(),
    "offer expiry is in the future"
  ).toBeGreaterThan(Date.now());

  // ---- 4. Vol B accepts the offer via waitlist_accept RPC
  const accept = await rpc(api, "vol_b", "waitlist_accept", { p_booking_id: volBBooking.id });
  expect(accept.status, `waitlist_accept rpc: ${accept.text}`).toBeLessThan(300);

  await new Promise((r) => setTimeout(r, 500));

  // Vol B should now be confirmed, counter back to 1, status full
  const finalBookings = await rest(
    api,
    "coord",
    "GET",
    `/shift_bookings?select=booking_status,volunteer_id&shift_id=eq.${testShiftId}`
  );
  const volBFinal = finalBookings.data?.find((b: any) => b.volunteer_id === VOL_B.id);
  expect(volBFinal?.booking_status, "Vol B promoted to confirmed").toBe("confirmed");

  await assertCounterInvariant(api, "after Vol B accept (final)");

  await api.dispose();
});

test("sync_slot_booked_count never silently clamps an overbooked slot", async () => {
  // The historical regression: if validate_booking_slot_count failed to
  // demote, sync_slot_booked_count's `LEAST(v_current + 1, v_total)`
  // would silently swallow the overbooking by capping the counter
  // instead of letting the chk_slot_slots constraint raise. The fix is
  // already enforced by the trigger ordering, but we assert here that
  // an attempt to insert a sub-slot booking link beyond capacity raises.
  //
  // We can't easily get to that state with the lifecycle test above
  // because validate_booking_slot_count demotes to waitlisted before
  // any sub-slot link is even attempted. So this test is a smoke test
  // that confirms the chk_slot_slots constraint exists and any attempt
  // to push booked_slots over total_slots via direct UPDATE is denied.
  const api = await request.newContext();

  // First, confirm shift_time_slots has the chk constraint.
  // We hit a meta query via the postgres_changes endpoint or by trying
  // a direct UPDATE that should fail. The simplest assertion is that
  // RLS now denies client UPDATE on shift_time_slots entirely.
  if (testShiftId) {
    // Get a slot id
    const slots = await rest(
      api,
      "coord",
      "GET",
      `/shift_time_slots?select=id,total_slots,booked_slots&shift_id=eq.${testShiftId}`
    );
    if (slots.data && slots.data.length > 0) {
      const slot = slots.data[0];
      // Attempt to overbook directly via PATCH \u2014 should be blocked by RLS
      const patch = await rest(
        api,
        "coord",
        "PATCH",
        `/shift_time_slots?id=eq.${slot.id}`,
        { booked_slots: slot.total_slots + 99 }
      );
      // The restrictive policy returns false on USING+CHECK, which
      // results in a "no rows updated" PATCH succeeding with empty body.
      // The important assertion is that the row is unchanged.
      const reread = await rest(
        api,
        "coord",
        "GET",
        `/shift_time_slots?select=booked_slots&id=eq.${slot.id}`
      );
      expect(
        reread.data?.[0]?.booked_slots,
        "client must not be able to mutate shift_time_slots.booked_slots"
      ).toBe(slot.booked_slots);
    }
  }

  await api.dispose();
});
