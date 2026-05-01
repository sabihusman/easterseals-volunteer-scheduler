import { supabase } from "@/integrations/supabase/client";

/**
 * Shift cancellation flow shared by ManageShifts (coordinator) and
 * AdminDashboard (admin "cancel"). Encapsulates the four-step transaction:
 *
 *   1. Read confirmed bookings (so we know who to notify)
 *   2. UPDATE shifts.status='cancelled' …RETURNING id  (the .select() is
 *      load-bearing: PostgREST returns 200 + empty array when RLS filters
 *      the row out, so without RETURNING we can't distinguish a real
 *      success from an RLS denial. The previous code shipped 200/[] as
 *      "Shift deleted" — audit 2026-04-28, PR fix below.)
 *   3. UPDATE all confirmed shift_bookings → cancelled (best-effort,
 *      doesn't block the success path)
 *   4. INSERT one `shift_cancelled` notification per affected volunteer.
 *      The DB notification webhook fans these out to email/SMS based on
 *      the volunteer's per-channel prefs and the SMS_ENABLED env flag;
 *      we attach `data.sms_eligible` so only urgent (<24h) cancellations
 *      page volunteers via SMS.
 *
 * The same helper is used by both roles. RLS is what gates whether the
 * UPDATE actually fires — admins succeed via `is_admin()`, coordinators
 * succeed via the "shifts: coord/admin update" policy that checks
 * department membership. If neither matches, step 2 returns 0 rows and
 * we surface that as "not_allowed".
 */

export interface CancelShiftInput {
  shift: {
    id: string;
    title: string;
    shift_date: string;
    start_time?: string | null;
    end_time?: string | null;
    department_id?: string;
    departments?: { name: string } | null;
  };
  /** Optional explanation surfaced in the email + notification message. */
  reason: string | null;
  /**
   * True iff the shift starts within 24h of "now". Drives whether the
   * cancellation notification carries `data.sms_eligible: true`. The
   * webhook reads that flag and only sends Twilio SMS when it's set
   * (AND the SMS_ENABLED env flag is true). 24h+ cancellations send
   * email + in-app only — see PR description for the rationale.
   */
  isUrgent: boolean;
  /** Pre-formatted "Apr 9, 2026" — caller already has parseShiftDate. */
  shiftDateFormatted: string;
  /** Pre-formatted "Custom · 10:00 AM – 2:00 PM" — caller already has timeLabel. */
  shiftTimeLabel: string;
}

export type CancelShiftResult =
  | { ok: true; notifiedCount: number }
  | { ok: false; kind: "not_allowed"; message: string }
  | { ok: false; kind: "error"; message: string };

export async function cancelShiftWithNotifications(
  input: CancelShiftInput,
): Promise<CancelShiftResult> {
  const { shift, reason, isUrgent, shiftDateFormatted, shiftTimeLabel } = input;

  // 1. Read affected bookings — confirmed AND pending_admin_approval
  //    (Half B-1: minor bookings still in the queue need to be
  //    cancelled and notified too, per the brief's cascade rule).
  //    RLS may legitimately return zero here even on shifts the
  //    coordinator can update (no booked volunteers), so this is
  //    informational only and must not gate the cancel.
  const { data: bookings } = await supabase
    .from("shift_bookings")
    .select("id, volunteer_id")
    .eq("shift_id", shift.id)
    .in("booking_status", ["confirmed", "pending_admin_approval"] as never[]);

  const affected = (bookings ?? []) as Array<{ id: string; volunteer_id: string }>;

  // 2. UPDATE shift.status='cancelled' …RETURNING id. The .select() is
  //    the correctness fix from the audit: a zero-length response means
  //    RLS denied the write and we MUST surface that as an error.
  // PostgREST embedded select types diverge from the generated types
  // here; same single-cast boundary documented in eslint.config.js.
  const { data: updated, error: updateError } = await supabase
    .from("shifts")
    .update({ status: "cancelled" } as never)
    .eq("id", shift.id)
    .select("id");

  if (updateError) {
    return { ok: false, kind: "error", message: updateError.message };
  }
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      kind: "not_allowed",
      message:
        "You don't have permission to cancel this shift, or it has already been cancelled. Refresh the page and try again.",
    };
  }

  // 3. Cancel the bookings. Best-effort — if this fails, the shift is
  //    already cancelled (volunteers can't see it on the dashboard
  //    anyway because the dashboard filters cancelled shifts) and the
  //    notifications go out regardless. Don't fail the whole operation
  //    on a partial booking-cancel; surface success.
  if (affected.length > 0) {
    await supabase
      .from("shift_bookings")
      .update({
        booking_status: "cancelled",
        cancelled_at: new Date().toISOString(),
      } as never)
      .eq("shift_id", shift.id)
      .in("booking_status", ["confirmed", "pending_admin_approval"] as never[]);
  }

  // 4. Notification fan-out. The `data` payload is read by both the
  //    in-app NotificationBell renderer AND the notification-webhook
  //    when it builds the email/SMS payload. The webhook reads
  //    `data.sms_eligible` to decide whether to invoke Twilio for
  //    THIS particular notification (independent of the global
  //    SMS_ENABLED flag, which is the secondary kill switch).
  if (affected.length > 0) {
    const reasonClause = reason ? ` Reason: ${reason}` : "";
    const baseMessage = `Your shift "${shift.title}" on ${shiftDateFormatted} (${shiftTimeLabel}) has been cancelled.${reasonClause}`;

    const notifications = affected.map((b) => ({
      user_id: b.volunteer_id,
      type: "shift_cancelled",
      title: `Shift Cancelled — ${shift.title}`,
      message: baseMessage,
      link: "/dashboard",
      data: {
        shift_id: shift.id,
        shift_title: shift.title,
        shift_date: shift.shift_date,
        shift_time: shiftTimeLabel,
        department: shift.departments?.name ?? "",
        cancellation_reason: reason || null,
        // The webhook gates SMS on this flag specifically. Long-lead
        // (>24h) cancellations skip SMS even when the global flag and
        // the volunteer's per-user preference both allow it.
        sms_eligible: isUrgent,
      },
    }));

    // Boundary cast — notifications.data is jsonb in the schema; the
    // generated types model it as `Json`, which doesn't carry through
    // our literal payload's shape. Single-line cast, same pattern as
    // eslint.config.js documents.
    await supabase.from("notifications").insert(notifications as never);
  }

  return { ok: true, notifiedCount: affected.length };
}
