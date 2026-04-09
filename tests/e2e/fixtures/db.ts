import type { APIRequestContext } from "@playwright/test";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./session";

// Re-export so spec files can import these constants from a single
// fixtures entry point. The original split between session.ts and
// db.ts was an internal artifact — every spec that calls a db helper
// also needs the URL/key to make ad-hoc REST calls under the user's
// own session, and forcing them to import from two paths just to
// satisfy module boundaries was a footgun. Several specs already
// import these from "./fixtures/db" expecting them to be exported.
export { SUPABASE_URL, SUPABASE_ANON_KEY };

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
 * Pick a department the test coordinator is assigned to. In the
 * production DB this is the "Adult Day Program (Life Club)"
 * department. Falls back to the first department visible to the
 * coordinator if that name changes.
 */
export async function getTestDepartmentId(
  request: APIRequestContext,
  accessToken: string
): Promise<string> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/department_coordinators?select=department_id,departments(name)&limit=1`,
    { headers: headers(accessToken) }
  );
  if (!res.ok()) {
    throw new Error(`getTestDepartmentId: ${res.status()} ${await res.text()}`);
  }
  const rows = await res.json();
  if (!rows || rows.length === 0) {
    throw new Error(
      "No department_coordinators row found for test coordinator"
    );
  }
  return rows[0].department_id;
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
