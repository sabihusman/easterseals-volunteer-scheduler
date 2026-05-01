import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInAs, adminBypassClient, getHarnessUsers } from "./clients";
import { TEST_DEPARTMENT_ID, TEST_LOCATION_ID } from "./setup";

/**
 * Regression coverage for prevent_overlapping_bookings.
 *
 * Origin: investigate/booking-overlap-behavior — Sabih reported being able
 * to book "overlapping" shifts across departments. The dashboard
 * screenshot showed two same-day bookings on different departments
 * (slots 10:00–12:00 and 12:00–14:00) which is actually adjacent, not
 * overlapping. Static analysis of the trigger predicate
 * (supabase/migrations/20260101000000_baseline.sql:1545) confirmed:
 *
 *   WHERE sb.volunteer_id = NEW.volunteer_id
 *     AND sb.booking_status IN ('confirmed', 'waitlisted')
 *     AND sb.id != NEW.id
 *     AND s.shift_date = new_date
 *     AND COALESCE(sts.slot_start, s.start_time) < new_end
 *     AND COALESCE(sts.slot_end,   s.end_time)   > new_start;
 *
 * Predicate is scoped purely by (volunteer, date, half-open interval).
 * No filter on department_id, shift_id, or location. Cross-department
 * true overlaps therefore SHOULD be blocked.
 *
 * These four scenarios are the empirical proof, lifted directly from
 * the investigation brief. They lock in the predicate's correctness
 * so a future migration can't regress to a department-scoped check
 * without this test failing.
 *
 * Cleanup: per harness convention, every row created here is cleaned
 * up in afterAll using the service-role bypass client. Service-role
 * is fine for setup + teardown; the assertion path uses the
 * volunteer-authenticated client so the trigger fires exactly the
 * way it would in production.
 */

// 7 days out — comfortably inside the 14-day default booking window and
// late enough to not collide with any "today" trigger logic. Computed
// at module-load so each CI run picks a relative date; using a fixed
// far-future date hit the booking-window-exceeded trigger (max 14 days
// ahead unless the volunteer has extended_booking).
const SHIFT_DATE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
})();
const DEPT_A = TEST_DEPARTMENT_ID;
const DEPT_B_ID = "00000000-0000-0000-0000-000000000299";

interface ShiftRow {
  id: string;
  title: string;
}

let shift1: ShiftRow; // Dept A, 10–12
let shift2: ShiftRow; // Dept A, 11–13 (overlaps shift1)
let shift3: ShiftRow; // Dept B, 10–12 (same time as shift1, different dept)
let shift4: ShiftRow; // Dept B, 11–13 (overlaps shift1, cross-dept)
let shift5: ShiftRow; // Dept B, 12–14 (adjacent to shift1)

beforeAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();

  // Pre-flight: a separate trigger blocks shift_bookings inserts when
  // the volunteer's profile is missing an emergency contact. The
  // harness seeds profiles without one, which would mask the overlap
  // trigger we're actually testing here. Stamp valid emergency-contact
  // fields on the volunteer once. (Service-role bypass is the right
  // tool for setup; the assertion path still runs as the volunteer.)
  await admin
    .from("profiles")
    .update({
      emergency_contact_name: "Harness Contact",
      emergency_contact_phone: "555-555-0100",
    } as never)
    .eq("id", users.volunteer.id);

  // Department B at the SAME location as Dept A. The location dimension
  // is irrelevant to the trigger — predicate doesn't reference it — but
  // we include it explicitly so a future location-scoped check would
  // still see the shifts as "different sites" if it ever materialized.
  await admin.from("departments").upsert(
    {
      id: DEPT_B_ID,
      name: "Test Department B",
      location_id: TEST_LOCATION_ID,
      is_active: true,
      requires_bg_check: false,
      allows_groups: false,
    } as never,
    { onConflict: "id" }
  );

  // All five shifts. created_by = admin user (service-role insert
  // bypasses RLS but the FK still requires a real auth.users row).
  const shifts = [
    { dept: DEPT_A, title: "S1 Dept A 10-12", start: "10:00:00", end: "12:00:00" },
    { dept: DEPT_A, title: "S2 Dept A 11-13", start: "11:00:00", end: "13:00:00" },
    { dept: DEPT_B_ID, title: "S3 Dept B 10-12", start: "10:00:00", end: "12:00:00" },
    { dept: DEPT_B_ID, title: "S4 Dept B 11-13", start: "11:00:00", end: "13:00:00" },
    { dept: DEPT_B_ID, title: "S5 Dept B 12-14", start: "12:00:00", end: "14:00:00" },
  ];
  const inserted: ShiftRow[] = [];
  for (const s of shifts) {
    const { data, error } = await admin
      .from("shifts")
      .insert({
        department_id: s.dept,
        created_by: users.admin.id,
        title: s.title,
        shift_date: SHIFT_DATE,
        time_type: "morning",
        start_time: s.start,
        end_time: s.end,
        total_slots: 5,
        requires_bg_check: false,
      } as never)
      .select("id, title")
      .single();
    if (error) throw new Error(`shift insert failed (${s.title}): ${error.message}`);
    inserted.push(data as ShiftRow);
  }
  [shift1, shift2, shift3, shift4, shift5] = inserted;
});

afterAll(async () => {
  const admin = adminBypassClient();
  const ids = [shift1, shift2, shift3, shift4, shift5].filter(Boolean).map((s) => s.id);
  // Bookings cascade-delete via FK; explicit just to be safe.
  await admin.from("shift_bookings").delete().in("shift_id", ids);
  await admin.from("shifts").delete().in("id", ids);
  await admin.from("departments").delete().eq("id", DEPT_B_ID);
});

/**
 * Helper: attempt a booking as the volunteer. Returns the supabase
 * error (or null if the insert succeeded). Tests assert on the
 * presence/absence of the trigger's RAISE EXCEPTION message.
 */
async function attemptBooking(
  client: Awaited<ReturnType<typeof signInAs>>,
  volunteerId: string,
  shiftId: string,
) {
  return await client
    .from("shift_bookings")
    .insert({
      shift_id: shiftId,
      volunteer_id: volunteerId,
      booking_status: "confirmed",
    } as never)
    .select("id")
    .single();
}

async function clearVolunteerBookings(volunteerId: string) {
  const admin = adminBypassClient();
  await admin.from("shift_bookings").delete().eq("volunteer_id", volunteerId);
}

describe("prevent_overlapping_bookings — cross-department coverage", () => {
  it("blocks same-department overlap (S1 then S2 in Dept A)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    await clearVolunteerBookings(users.volunteer.id);

    // S1 books cleanly.
    const first = await attemptBooking(client, users.volunteer.id, shift1.id);
    expect(first.error).toBeNull();

    // S2 (Dept A, 11-13) overlaps S1 (Dept A, 10-12). Trigger blocks.
    const second = await attemptBooking(client, users.volunteer.id, shift2.id);
    expect(second.error).not.toBeNull();
    expect(second.error?.message).toMatch(/overlaps with this shift time/i);
  });

  it("blocks cross-department same-time overlap (S1 Dept A then S3 Dept B, both 10–12)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    await clearVolunteerBookings(users.volunteer.id);

    const first = await attemptBooking(client, users.volunteer.id, shift1.id);
    expect(first.error).toBeNull();

    // S3 is Dept B at the same time as S1 Dept A. If the predicate
    // were department-scoped, this insert would slip through.
    const second = await attemptBooking(client, users.volunteer.id, shift3.id);
    expect(second.error).not.toBeNull();
    expect(second.error?.message).toMatch(/overlaps with this shift time/i);
  });

  it("blocks cross-department partial overlap (S1 Dept A 10–12 then S4 Dept B 11–13)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    await clearVolunteerBookings(users.volunteer.id);

    const first = await attemptBooking(client, users.volunteer.id, shift1.id);
    expect(first.error).toBeNull();

    const second = await attemptBooking(client, users.volunteer.id, shift4.id);
    expect(second.error).not.toBeNull();
    expect(second.error?.message).toMatch(/overlaps with this shift time/i);
  });

  it("allows cross-department adjacent (S1 Dept A 10–12 then S5 Dept B 12–14)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    await clearVolunteerBookings(users.volunteer.id);

    const first = await attemptBooking(client, users.volunteer.id, shift1.id);
    expect(first.error).toBeNull();

    // 12:00 < 12:00 is false → not an overlap. This is the case the
    // dashboard screenshot showed; correctly allowed by the trigger.
    const second = await attemptBooking(client, users.volunteer.id, shift5.id);
    expect(second.error).toBeNull();
  });
});
