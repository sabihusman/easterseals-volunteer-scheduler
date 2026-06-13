import type { APIRequestContext } from "@playwright/test";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY } from "./session";

// Re-export so spec files can import these constants from a single
// fixtures entry point. The original split between session.ts and
// db.ts was an internal artifact — every spec that calls a db helper
// also needs the URL/key to make ad-hoc REST calls under the user's
// own session, and forcing them to import from two paths just to
// satisfy module boundaries was a footgun. Several specs already
// import these from "./fixtures/db" expecting them to be exported.
export { SUPABASE_URL, SUPABASE_ANON_KEY };

/**
 * Headers for invoking a function as service_role (bypasses RLS and
 * has implicit EXECUTE on every function in `public`).
 *
 * Use this ONLY for invoking cron-callback functions
 * (transition_past_shifts_to_completed, reconcile_shift_counters,
 * send_self_confirmation_reminders, etc.) that the Phase 2 lockdown
 * revoked from anon/authenticated. In prod those functions are fired
 * by pg_cron as the postgres superuser — calling them as service_role
 * in tests is the closest equivalent. Never use service_role for
 * routine user-driven REST calls; that path bypasses RLS and will
 * silently mask authorization bugs the test is supposed to catch.
 */
export function serviceRoleHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Prefer: "return=representation",
  };
}

/**
 * Supabase REST helpers for E2E setup / teardown / verification.
 *
 * All calls are made under an authenticated session so RLS applies.
 * Pass in the role's access_token from signInAsRole().
 */

function headers(accessToken: string) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    Prefer: "return=representation",
  };
}

/**
 * Public version of `headers` for spec files that issue ad-hoc REST
 * calls under their own session token.
 */
export function authHeaders(accessToken: string) {
  return headers(accessToken);
}

/**
 * Generate a unique YYYY-MM-DD date in the future, offset N days from
 * today. Each spec uses a distinct offset so no two test shifts share
 * a date — this avoids the prevent_overlapping_bookings trigger ever
 * firing across tests, since the trigger keys on (volunteer_id,
 * shift_date, time-overlap).
 *
 * Far-future dates also stay clear of any real production shifts the
 * test users might already be booked on.
 */
export function uniqueShiftDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86400000)
    .toISOString()
    .slice(0, 10);
}

export function uniquePastShiftDate(offsetDays: number): string {
  return new Date(Date.now() - Math.abs(offsetDays) * 86400000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Wrap a Playwright APIResponse so a non-OK status throws with the
 * full response body included in the error message — instead of the
 * useless "expect(false).toBeTruthy()" we were getting before.
 */
export async function expectOk(
  res: { ok: () => boolean; status: () => number; text: () => Promise<string> },
  label: string
): Promise<void> {
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`${label} failed: HTTP ${res.status()} ${body}`);
  }
}

/**
 * Ensure the test volunteer has emergency contacts set. The
 * enforce_booking_window trigger rejects bookings when either
 * emergency_contact_name or emergency_contact_phone is null.
 * Call this once per test run (not per test) to avoid failures
 * when running against a freshly-wiped DB.
 */
export async function ensureEmergencyContact(
  request: APIRequestContext,
  volunteerAccessToken: string,
  volunteerId: string
): Promise<void> {
  const { data } = await request
    .get(
      `${SUPABASE_URL}/rest/v1/profiles?select=emergency_contact_name,emergency_contact_phone&id=eq.${volunteerId}`,
      { headers: headers(volunteerAccessToken) }
    )
    .then(async (r) => ({ data: (await r.json())?.[0] }));

  if (!data?.emergency_contact_name || !data?.emergency_contact_phone) {
    await request.patch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${volunteerId}`,
      {
        headers: headers(volunteerAccessToken),
        data: {
          emergency_contact_name: "Test Emergency Contact",
          emergency_contact_phone: "555-000-1234",
        },
      }
    );
  }
}

/**
 * Cancel ALL active bookings the given volunteer holds, so leftover
 * state from a real-life booking or a previous failed/retried test run
 * can't poison the prevent_overlapping_bookings trigger.
 *
 * "Active" = the exact status set the overlap trigger treats as
 * conflicting: ('confirmed', 'waitlisted', 'pending_admin_approval')
 * after the Half B-1 minor-approval queue (20260501100001).
 *
 * Why no date scoping (despite the `shiftDate` param):
 *   The previous implementation scoped the SELECT to one date via a
 *   PostgREST embedded-resource filter:
 *     ?select=id,shifts!inner(shift_date)&shifts.shift_date=eq.<date>
 *   That filter silently matched ZERO rows in CI (an embedded-resource
 *   filter quirk — the parent rows weren't being restricted as
 *   intended), so the cleanup was a no-op: it cancelled nothing, the
 *   post-cancel verify saw nothing, and the downstream insert then
 *   tripped the overlap trigger against the real, never-cancelled
 *   leftover. This dogged CI runs #1082–#1084 (the
 *   pending_admin_approval filter widening and the verify step both
 *   appeared correct but never ran against any rows).
 *
 *   The test volunteer is a dedicated account with no bookings worth
 *   preserving, so the robust fix is to cancel EVERY active booking
 *   with a single flat query — no embed, no date filter, nothing to
 *   silently mis-match. The `shiftDate` param is retained for
 *   call-site compatibility but intentionally unused.
 *
 * Runs entirely under service_role: it bypasses RLS (SELECT sees every
 * row), the `bookings: volunteer cancel` WITH CHECK column locks, and
 * the enforce_admin_only_approval pending→confirmed/rejected gate
 * (cancelled is always permitted, but service_role removes ambiguity).
 * This is test SETUP only, never an assertion path — it does not
 * bypass any policy the tests exercise. Every response is checked, and
 * a post-cancel re-query throws if anything survives, converting the
 * old silent-failure mode into a loud one.
 */
export async function cancelVolunteerBookingsOnDate(
  request: APIRequestContext,
  _volunteerAccessToken: string,
  volunteerId: string,
  _shiftDate: string
): Promise<number> {
  const ACTIVE = "(confirmed,waitlisted,pending_admin_approval)";
  const findUrl =
    `${SUPABASE_URL}/rest/v1/shift_bookings` +
    `?select=id,booking_status&volunteer_id=eq.${volunteerId}` +
    `&booking_status=in.${ACTIVE}`;

  const findRes = await request.get(findUrl, { headers: serviceRoleHeaders() });
  await expectOk(findRes, "cancelVolunteerBookings: find");
  const rows = (await findRes.json()) as Array<{ id: string }>;
  if (!rows || rows.length === 0) return 0;

  for (const row of rows) {
    const patchRes = await request.patch(
      `${SUPABASE_URL}/rest/v1/shift_bookings?id=eq.${row.id}`,
      {
        headers: serviceRoleHeaders(),
        data: {
          booking_status: "cancelled",
          cancelled_at: new Date().toISOString(),
        },
      }
    );
    await expectOk(patchRes, `cancelVolunteerBookings: cancel ${row.id}`);
  }

  // Verify the volunteer has no active bookings left — fail loudly here
  // rather than letting the downstream booking insert hit the overlap
  // trigger with a confusing P0001.
  const verifyRes = await request.get(findUrl, { headers: serviceRoleHeaders() });
  await expectOk(verifyRes, "cancelVolunteerBookings: verify");
  const remaining = (await verifyRes.json()) as Array<{ id: string }>;
  if (remaining.length > 0) {
    throw new Error(
      `cancelVolunteerBookings: ${remaining.length} active booking(s) still ` +
        `present for volunteer ${volunteerId} after cancel (ids: ` +
        `${remaining.map((r) => r.id).join(", ")}). The cancel did not take ` +
        `effect — investigate before the overlap trigger fires.`
    );
  }
  return rows.length;
}

export interface CreatedShift {
  id: string;
  title: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  total_slots: number;
  booked_slots: number;
  status: string;
  department_id: string;
}

/**
 * Create a fresh shift owned by the authenticated user (must be a
 * coordinator or admin for their department).
 *
 * NOTE: `shifts.created_by` is NOT NULL in the schema. The default
 * value is auth.uid() *only* when the row is inserted via PostgREST
 * with that column omitted AND the column has a `DEFAULT auth.uid()`.
 * The current schema does not, so the caller must pass the
 * coordinator's user id explicitly. Get it from the user object
 * returned by signInAsRole().
 */
export async function createShift(
  request: APIRequestContext,
  accessToken: string,
  overrides: Partial<CreatedShift> & {
    department_id: string;
    created_by: string;
    total_slots?: number;
  }
): Promise<CreatedShift> {
  const tomorrow = new Date(Date.now() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const body = {
    title: overrides.title || `E2E Test Shift ${Date.now()}`,
    shift_date: overrides.shift_date || tomorrow,
    time_type: "custom",
    start_time: overrides.start_time || "10:00:00",
    end_time: overrides.end_time || "12:00:00",
    total_slots: overrides.total_slots ?? 1,
    requires_bg_check: false,
    status: "open",
    department_id: overrides.department_id,
    created_by: overrides.created_by,
  };
  const res = await request.post(`${SUPABASE_URL}/rest/v1/shifts`, {
    headers: headers(accessToken),
    data: body,
  });
  if (!res.ok()) {
    throw new Error(`createShift failed: ${res.status()} ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0];
}

export async function deleteShift(
  request: APIRequestContext,
  accessToken: string,
  shiftId: string
): Promise<void> {
  await request.delete(`${SUPABASE_URL}/rest/v1/shifts?id=eq.${shiftId}`, {
    headers: headers(accessToken),
  });
}

export async function getShift(
  request: APIRequestContext,
  accessToken: string,
  shiftId: string
): Promise<CreatedShift | null> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/shifts?select=id,title,shift_date,start_time,end_time,total_slots,booked_slots,status,department_id&id=eq.${shiftId}`,
    { headers: headers(accessToken) }
  );
  if (!res.ok()) return null;
  const rows = await res.json();
  return rows[0] || null;
}

export interface BookingRow {
  id: string;
  shift_id: string;
  volunteer_id: string;
  booking_status: string;
  confirmation_status: string;
  final_hours: number | null;
  waitlist_offer_expires_at: string | null;
}

export async function listBookingsForShift(
  request: APIRequestContext,
  accessToken: string,
  shiftId: string
): Promise<BookingRow[]> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/shift_bookings?select=id,shift_id,volunteer_id,booking_status,confirmation_status,final_hours,waitlist_offer_expires_at&shift_id=eq.${shiftId}&order=created_at.asc`,
    { headers: headers(accessToken) }
  );
  if (!res.ok()) {
    throw new Error(
      `listBookingsForShift failed: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

/** Count rows in a table filtered by a shift_id — used for orphan checks. */
export async function countBy(
  request: APIRequestContext,
  accessToken: string,
  table: string,
  column: string,
  value: string
): Promise<number> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/${table}?select=${column}&${column}=eq.${value}`,
    { headers: { ...headers(accessToken), Prefer: "count=exact" } }
  );
  // PostgREST returns the count in the Content-Range header.
  const range = res.headers()["content-range"];
  if (range) {
    const total = range.split("/")[1];
    return parseInt(total, 10) || 0;
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Pick a department the caller is authorized to create shifts in.
 *
 * For coordinators: returns one of their `department_coordinators`
 * assignments. For admins (who typically have no row in that table):
 * falls back to any active department, since `shifts` RLS lets admins
 * insert regardless of department assignment.
 *
 * Why the `callerUserId` arg matters:
 *   The `dept_coords: coord read` RLS policy lets ANY coordinator or
 *   admin SELECT ALL rows in `department_coordinators`. An earlier
 *   version of this helper queried with `limit=1` and no filter, so
 *   PostgREST returned an arbitrary row — in multi-coordinator DBs,
 *   often some OTHER coordinator's assignment. Passing that unrelated
 *   `department_id` into `createShift` then triggered the 403 on
 *   `shifts` INSERT (the `EXISTS` check in the shifts policy requires
 *   `coordinator_id = auth.uid()`). Filtering by `callerUserId`
 *   guarantees we pick one of the caller's own departments.
 */
export async function getTestDepartmentId(
  request: APIRequestContext,
  accessToken: string,
  callerUserId: string
): Promise<string> {
  // Coordinator path: filter to the caller's own assignments.
  const mine = await request.get(
    `${SUPABASE_URL}/rest/v1/department_coordinators?select=department_id&coordinator_id=eq.${callerUserId}&limit=1`,
    { headers: headers(accessToken) }
  );
  if (mine.ok()) {
    const rows = await mine.json();
    if (rows && rows.length > 0) return rows[0].department_id;
  }

  // Admin fallback: admins typically have no department_coordinators
  // row. They can insert shifts into any department per RLS, so any
  // active department works.
  const any = await request.get(
    `${SUPABASE_URL}/rest/v1/departments?select=id&is_active=eq.true&limit=1`,
    { headers: headers(accessToken) }
  );
  if (!any.ok()) {
    throw new Error(`getTestDepartmentId: ${any.status()} ${await any.text()}`);
  }
  const rows = await any.json();
  if (!rows || rows.length === 0) {
    throw new Error("No active departments available for test");
  }
  return rows[0].id;
}

/**
 * Delete ALL shifts whose title starts with "E2E-". These are
 * exclusively created by the Playwright test fixtures — real shifts
 * never use this prefix. This is the primary defense against orphaned
 * test data: each spec calls this in beforeAll so that any leftovers
 * from a previous failed run (where afterAll never executed) are
 * cleaned before the next run creates new ones.
 *
 * Safe against real data: the WHERE clause is `title LIKE 'E2E-%'`.
 * A human-created shift would have to be intentionally named with
 * that prefix to be affected.
 */
/**
 * IMPORTANT: call this with the ADMIN access token, not the
 * coordinator's. The coordinator's RLS only allows deleting shifts
 * in their own departments — E2E shifts in other departments
 * silently survive the DELETE. The admin has unrestricted DELETE.
 */
export async function cleanupStaleE2EShifts(
  request: APIRequestContext,
  adminAccessToken: string
): Promise<number> {
  // 1. Find all E2E shift IDs first
  const listRes = await request.get(
    `${SUPABASE_URL}/rest/v1/shifts?select=id&title=like.E2E-%25`,
    { headers: headers(adminAccessToken) }
  );
  if (!listRes.ok()) return 0;
  const shiftRows = (await listRes.json()) as Array<{ id: string }>;
  if (!shiftRows || shiftRows.length === 0) return 0;

  const ids = shiftRows.map((r) => r.id);

  // 2. Explicitly delete bookings for these shifts (belt-and-suspenders
  // in case CASCADE doesn't fire through RLS context)
  for (const id of ids) {
    await request.delete(
      `${SUPABASE_URL}/rest/v1/shift_bookings?shift_id=eq.${id}`,
      { headers: headers(adminAccessToken) }
    );
  }

  // 3. Delete the shifts themselves
  const res = await request.delete(
    `${SUPABASE_URL}/rest/v1/shifts?title=like.E2E-%25`,
    { headers: { ...headers(adminAccessToken), Prefer: "return=representation" } }
  );
  if (!res.ok()) return 0;
  const deleted = await res.json();
  return Array.isArray(deleted) ? deleted.length : 0;
}

/** Nuke a shift and everything it owns — used for teardown safety. */
export async function hardCleanupShift(
  request: APIRequestContext,
  accessToken: string,
  shiftId: string
): Promise<void> {
  // shift cascade should take care of bookings/slots/reports, but be
  // explicit in case a test left something in an odd state.
  await request.delete(
    `${SUPABASE_URL}/rest/v1/shift_bookings?shift_id=eq.${shiftId}`,
    { headers: headers(accessToken) }
  );
  await request.delete(
    `${SUPABASE_URL}/rest/v1/volunteer_shift_reports?shift_id=eq.${shiftId}`,
    { headers: headers(accessToken) }
  );
  await request.delete(`${SUPABASE_URL}/rest/v1/shifts?id=eq.${shiftId}`, {
    headers: headers(accessToken),
  });
}
