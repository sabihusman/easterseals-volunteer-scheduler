import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInAs, adminBypassClient, getHarnessUsers } from "./clients";

/**
 * Pins the column-lock contract from
 * 20260502000000_lock_admin_only_profile_columns.sql.
 *
 * Background: discovered during the Half B-1 prod-migration
 * investigation — `profiles: own update` had no WITH CHECK clause,
 * so a volunteer could PATCH their own bg_check_status from
 * 'pending' to 'cleared' and bypass the booking-window BG-check
 * gate. The fix is a BEFORE UPDATE trigger
 * (prevent_user_from_changing_admin_columns) that raises 42501 when
 * a non-admin tries to mutate any of the locked columns on their
 * own row.
 *
 * These tests exercise both the negative cases (volunteer cannot
 * write the locked columns) and the positive case (volunteer CAN
 * still update normal self-edit columns like full_name and
 * emergency contact).
 *
 * Per the lesson from PR #173: NO it.skip in this file.
 */

beforeAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();
  // Reset the volunteer's bg_check_status so the test starts from a
  // known state.
  await admin.from("profiles").update({
    bg_check_status: "pending",
    is_active: true,
    booking_privileges: true,
    is_minor: false,
    messaging_blocked: false,
  } as never).eq("id", users.volunteer.id);
});

afterAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();
  await admin.from("profiles").update({
    bg_check_status: "pending",
    is_active: true,
  } as never).eq("id", users.volunteer.id);
});

const expectRlsRejection = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  expect(e).not.toBeNull();
  expect(
    e?.code === "42501" || /cannot change|cannot be (set|modified)/i.test(e?.message ?? ""),
  ).toBe(true);
};

describe("profiles: column locks on volunteer self-update", () => {
  it("volunteer CANNOT change their own bg_check_status (the security finding)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ bg_check_status: "cleared" } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own is_active", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ is_active: false } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own booking_privileges", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ booking_privileges: false } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own is_minor (would bypass admin approval queue)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ is_minor: true } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own messaging_blocked", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ messaging_blocked: true } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change derived consistency_score / extended_booking / total_hours / volunteer_points", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const probes = [
      { consistency_score: 100 },
      { extended_booking: true },
      { total_hours: 999 },
      { volunteer_points: 9999 },
    ] as const;
    for (const patch of probes) {
      const { error } = await client
        .from("profiles")
        .update(patch as never)
        .eq("id", users.volunteer.id);
      expectRlsRejection(error);
    }
  });

  it("volunteer CAN still update normal self-edit columns (full_name, phone, emergency contact)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const newName = `Test Volunteer (${Date.now()})`;
    const { error, data } = await client
      .from("profiles")
      .update({
        full_name: newName,
        phone: "555-0100",
        emergency_contact_name: "Test Contact",
        emergency_contact_phone: "555-0200",
      } as never)
      .eq("id", users.volunteer.id)
      .select("id, full_name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ full_name: string }>)[0].full_name).toBe(newName);
  });

  it("admin CAN change a volunteer's bg_check_status (admin bypass)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("admin");
    const { error, data } = await client
      .from("profiles")
      .update({ bg_check_status: "cleared" } as never)
      .eq("id", users.volunteer.id)
      .select("id, bg_check_status");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ bg_check_status: string }>)[0].bg_check_status).toBe("cleared");
  });

  // ────────────────────────────────────────────────────────────────────
  // Regression coverage for the trusted-frame bypass added in
  // 20260502120000_profile_column_lock_trusted_frame_bypass.sql.
  //
  // Issue #187: the original PR #184 trigger blocked writes to
  // total_hours / consistency_score / volunteer_points even when the
  // write was reached via a SECURITY DEFINER trigger frame (the
  // legitimate aggregate-recompute path used by the volunteer
  // self-confirm flow). The hotfix adds a current_user-based bypass.
  //
  // This test pins the contract by simulating the actual flow: as a
  // volunteer, upsert a volunteer_shift_reports row with
  // self_reported_hours, which fires sync_volunteer_reported_hours()
  // (SECURITY DEFINER) which calls resolve_hours_discrepancy() which
  // updates profiles.total_hours. With the bypass in place, this
  // should succeed; without it, the trigger raises 42501 with
  // "total_hours is an aggregate".
  // ────────────────────────────────────────────────────────────────────
  it("volunteer self-confirm flow CAN write total_hours via the SECURITY DEFINER aggregate path", async () => {
    const admin = adminBypassClient();
    const users = getHarnessUsers();

    // Stage a shift + booking the volunteer is confirmed on. The shift
    // must be FUTURE at insert time — the BEFORE INSERT triggers on
    // shift_bookings (enforce_booking_window, enforce_shift_not_ended_
    // on_booking, block_bookings_on_completed_shifts) reject inserts
    // against past or completed shifts even via service-role, since
    // service-role bypasses RLS but not triggers.
    //
    // We don't actually need the shift to be in the past for this
    // test — the SECURITY-DEFINER-bypass behaviour we're verifying is
    // independent of shift timing. resolve_hours_discrepancy fires on
    // volunteer_shift_reports upsert and recomputes total_hours from
    // confirmed bookings with final_hours set. We make the booking
    // confirmation_status='confirmed' directly so the sum has a
    // contributing row.
    const FUTURE_DATE = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    })();

    const { data: shiftRow, error: shiftErr } = await admin.from("shifts").insert({
      department_id: "00000000-0000-0000-0000-000000000200",
      title: "Self-confirm regression shift",
      shift_date: FUTURE_DATE,
      time_type: "morning",
      start_time: "09:00:00",
      end_time: "11:00:00",
      total_slots: 5,
      booked_slots: 0,
      status: "open",
      requires_bg_check: false,
    } as never).select("id").single();
    if (shiftErr || !shiftRow) throw new Error(`Setup: shift insert failed: ${shiftErr?.message}`);
    const shiftId = (shiftRow as { id: string }).id;

    // Volunteer needs an emergency contact for enforce_booking_window
    // to pass during the booking insert. Stamp it now.
    await admin.from("profiles").update({
      emergency_contact_name: "Test Contact",
      emergency_contact_phone: "555-0100",
    } as never).eq("id", users.volunteer.id);

    const { data: bookingRow, error: bookingErr } = await admin.from("shift_bookings").insert({
      shift_id: shiftId,
      volunteer_id: users.volunteer.id,
      booking_status: "confirmed",
      // Stamp confirmation_status='confirmed' directly on insert so
      // resolve_hours_discrepancy's `sum(final_hours) WHERE
      // confirmation_status='confirmed'` will include this row. The
      // trg_recalculate_consistency_fn / trg_recalculate_points_fn
      // wrappers only fire on UPDATE of confirmation_status, not
      // INSERT, so direct insertion here doesn't invoke them.
      confirmation_status: "confirmed",
      checked_in: true,
      checked_in_at: new Date().toISOString(),
      coordinator_reported_hours: 2,
    } as never).select("id").single();
    if (bookingErr || !bookingRow) throw new Error(`Setup: booking insert failed: ${bookingErr?.message}`);
    const bookingId = (bookingRow as { id: string }).id;

    try {
      // The trigger sync_volunteer_reported_hours fires on volunteer_shift_reports
      // upsert. It runs SECURITY DEFINER and transitively calls
      // resolve_hours_discrepancy → UPDATE profiles SET total_hours.
      const client = await signInAs("volunteer");
      const { error } = await client
        .from("volunteer_shift_reports")
        .upsert({
          booking_id: bookingId,
          volunteer_id: users.volunteer.id,
          self_confirm_status: "attended",
          self_reported_hours: 2,
          star_rating: 5,
          submitted_at: new Date().toISOString(),
        } as never, { onConflict: "booking_id" });
      expect(error).toBeNull();

      // Verify the aggregate-recompute landed.
      const { data: profile } = await admin
        .from("profiles")
        .select("total_hours")
        .eq("id", users.volunteer.id)
        .single();
      expect((profile as { total_hours: number }).total_hours).toBeGreaterThan(0);
    } finally {
      await admin.from("volunteer_shift_reports").delete().eq("booking_id", bookingId);
      await admin.from("shift_bookings").delete().eq("id", bookingId);
      await admin.from("shifts").delete().eq("id", shiftId);
      // Reset profile aggregates for any subsequent test in the file.
      await admin.from("profiles").update({ total_hours: 0 } as never).eq("id", users.volunteer.id);
    }
  });
});
