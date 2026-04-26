import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { ShiftInvitation } from "@/hooks/useShiftInvitations";

/**
 * Service-layer functions for the dashboard booking + invitation flows.
 *
 * Conventions:
 *  - These functions own the supabase calls + notification fan-out, but do
 *    NOT call into React (no toasts, no setState). Callers translate the
 *    return values into UI feedback.
 *  - Each function returns a discriminated-union or `{ error }`-shaped result
 *    so callers can branch deterministically without inspecting supabase
 *    error shapes themselves.
 */

// Shape of one of "my" confirmed bookings as returned by the conflict probe.
interface ConflictCandidateShift {
  id: string;
  title: string;
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  department_id: string;
  departments: { name: string } | null;
}

interface ConflictCandidate {
  id: string;
  shifts: ConflictCandidateShift | null;
}

export type InvitationAcceptPlan =
  | { kind: "fully_booked" }
  | { kind: "conflict"; conflictBookingId: string; conflictShift: ConflictCandidateShift }
  | { kind: "ready" };

/**
 * Pre-flight check before completing an invitation accept.
 *
 *   - "fully_booked": the shift filled while the invitation sat in the inbox.
 *     Caller should auto-decline the invitation and surface a friendly toast.
 *   - "conflict": the volunteer already has a confirmed booking that overlaps
 *     the invited shift. Caller should open a conflict-resolution modal.
 *   - "ready": no blockers; proceed to acceptInvitation().
 */
export async function planInvitationAcceptance(
  invitation: ShiftInvitation,
  userId: string
): Promise<InvitationAcceptPlan> {
  const shift = invitation.shifts;
  if (!shift) return { kind: "ready" };

  const { data: freshShift } = await supabase
    .from("shifts")
    .select("booked_slots, total_slots")
    .eq("id", shift.id)
    .single();

  if (freshShift && freshShift.booked_slots >= freshShift.total_slots) {
    // Mark invitation as declined since they can't accept.
    await supabase
      .from("shift_invitations")
      .update({ status: "declined" })
      .eq("id", invitation.id);
    return { kind: "fully_booked" };
  }

  // Look for an existing confirmed booking on the same date that overlaps.
  const { data: myBookings } = await supabase
    .from("shift_bookings")
    .select("id, shifts(id, title, shift_date, start_time, end_time, department_id, departments(name))")
    .eq("volunteer_id", userId)
    .eq("booking_status", "confirmed");

  const candidates = ((myBookings as any[]) || []) as ConflictCandidate[];
  for (const b of candidates) {
    const s = b.shifts;
    if (!s || s.shift_date !== shift.shift_date) continue;
    // String comparison works because times are HH:MM:SS lexically sortable.
    if (
      s.start_time && s.end_time && shift.start_time && shift.end_time &&
      s.start_time < shift.end_time && s.end_time > shift.start_time
    ) {
      return { kind: "conflict", conflictBookingId: b.id, conflictShift: s };
    }
  }

  return { kind: "ready" };
}

interface AcceptInvitationParams {
  invitation: ShiftInvitation;
  userId: string;
  profileFullName: string | null;
  /** When the volunteer chose "cancel existing & accept", these identify the booking to cancel. */
  cancelBookingId?: string;
  cancelledShift?: ConflictCandidateShift;
}

interface AcceptInvitationResult {
  ok: boolean;
  /** Set when ok=false to give the caller a hint for the toast message. */
  error?: string;
}

/**
 * Complete an invitation acceptance: optionally cancel a conflicting booking,
 * book all time slots of the invited shift (or the shift itself if no slots),
 * flip the invitation to accepted, and notify admin + coordinators.
 */
export async function acceptInvitation(
  params: AcceptInvitationParams
): Promise<AcceptInvitationResult> {
  const { invitation, userId, profileFullName, cancelBookingId, cancelledShift } = params;
  const shift = invitation.shifts;
  if (!shift) return { ok: false, error: "Invitation has no shift" };

  // 1. Cancel conflicting booking if requested.
  if (cancelBookingId) {
    await supabase
      .from("shift_bookings")
      .update({ booking_status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", cancelBookingId);

    if (cancelledShift) {
      const { data: cancelCoords } = await supabase
        .from("department_coordinators")
        .select("coordinator_id")
        .eq("department_id", cancelledShift.department_id);

      const cancelNotifications = [
        {
          user_id: userId,
          type: "booking_cancelled",
          title: `Booking cancelled — ${cancelledShift.title}`,
          message: `Your booking for "${cancelledShift.title}" on ${cancelledShift.shift_date} was cancelled to accept an invitation for "${shift.title}".`,
          link: "/dashboard",
        },
        ...((cancelCoords as { coordinator_id: string }[] | null) || []).map((c) => ({
          user_id: c.coordinator_id,
          type: "booking_cancelled",
          title: `Volunteer cancelled — ${cancelledShift.title}`,
          message: `${profileFullName} cancelled their booking for "${cancelledShift.title}" on ${cancelledShift.shift_date} to accept an admin invitation for "${shift.title}".`,
          link: "/coordinator",
        })),
      ];
      await supabase.from("notifications").insert(cancelNotifications as never);
    }
  }

  // 2. Book the invited shift — per slot if slots exist, else the shift itself.
  const { data: slots } = await supabase
    .from("shift_time_slots")
    .select("id, total_slots, booked_slots")
    .eq("shift_id", shift.id)
    .order("slot_start", { ascending: true });

  let bookingError = false;
  if (slots && slots.length > 0) {
    for (const slot of slots) {
      const isFull = slot.booked_slots >= slot.total_slots;
      const { error } = await supabase.from("shift_bookings").insert({
        shift_id: shift.id,
        volunteer_id: userId,
        booking_status: isFull ? "waitlisted" : "confirmed",
        time_slot_id: slot.id,
      });
      if (error) { bookingError = true; break; }
    }
  } else {
    const { error } = await supabase.from("shift_bookings").insert({
      shift_id: shift.id,
      volunteer_id: userId,
      booking_status: "confirmed",
    });
    if (error) bookingError = true;
  }

  if (bookingError) {
    return { ok: false, error: "An error occurred while booking. Please try again." };
  }

  // 3. Flip invitation status.
  await supabase
    .from("shift_invitations")
    .update({ status: "accepted" })
    .eq("id", invitation.id);

  // 4. Notify admin (the inviter) + non-inviter coordinators.
  interface NotifRow {
    user_id: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  }
  const notifs: NotifRow[] = [
    {
      user_id: invitation.invited_by,
      type: "shift_invitation",
      title: `Invitation accepted — ${shift.title}`,
      message: `${profileFullName} accepted the invitation to "${shift.title}" on ${shift.shift_date}.`,
      data: { shift_id: shift.id, shift_title: shift.title, shift_date: shift.shift_date },
    },
  ];
  const { data: coords } = await supabase
    .from("department_coordinators")
    .select("coordinator_id")
    .eq("department_id", shift.department_id);
  for (const c of ((coords as { coordinator_id: string }[] | null) || [])) {
    if (c.coordinator_id !== invitation.invited_by) {
      notifs.push({
        user_id: c.coordinator_id,
        type: "shift_invitation",
        title: `Volunteer accepted invitation — ${shift.title}`,
        message: `${profileFullName} accepted an invitation to "${shift.title}" on ${shift.shift_date}.`,
        data: { shift_id: shift.id, shift_title: shift.title, shift_date: shift.shift_date },
      });
    }
  }
  await supabase.from("notifications").insert(notifs as never);

  return { ok: true };
}

interface DeclineInvitationParams {
  invitation: ShiftInvitation;
  profileFullName: string | null;
  reason?: string;
}

/** Mark invitation declined and notify the inviter. */
export async function declineInvitation(params: DeclineInvitationParams): Promise<void> {
  const { invitation, profileFullName, reason } = params;
  await supabase
    .from("shift_invitations")
    .update({ status: "declined" })
    .eq("id", invitation.id);

  const shift = invitation.shifts;
  await supabase.from("notifications").insert({
    user_id: invitation.invited_by,
    type: "shift_invitation",
    title: `Invitation declined — ${shift?.title || "shift"}`,
    message: `${profileFullName} declined the invitation to "${shift?.title}" on ${shift?.shift_date}.${reason ? ` Reason: ${reason}` : ""}`,
    data: { shift_id: shift?.id, shift_title: shift?.title, shift_date: shift?.shift_date },
  } as never);
}

// ---- Cancel booking ----

export type CancelPrecheck =
  | { kind: "missing" }
  | { kind: "already_cancelled" }
  | { kind: "ok" };

/** Confirm the booking still exists and is still confirmed before cancelling. */
export async function precheckCancel(bookingId: string): Promise<CancelPrecheck> {
  const { data: existing, error: checkError } = await supabase
    .from("shift_bookings")
    .select("id, booking_status")
    .eq("id", bookingId)
    .maybeSingle();

  if (checkError || !existing) return { kind: "missing" };
  if (existing.booking_status !== "confirmed") return { kind: "already_cancelled" };
  return { kind: "ok" };
}

interface CancelBookingShift {
  shift_date: string;
  start_time: string | null;
  title: string;
  department_id: string;
}

interface CancelBookingResult {
  ok: boolean;
  error?: string;
  /** Cancellation within 48 hours of shift start — affects consistency score messaging. */
  isLateCancel: boolean;
}

/**
 * Cancel a confirmed booking and, if cancellation is within 12 hours of the
 * shift start, fire late-cancellation notifications to all department
 * coordinators. Notification failures don't block the cancel.
 *
 * Caller is expected to have run precheckCancel() first.
 */
export async function cancelBooking(
  bookingId: string,
  shift: CancelBookingShift,
  profileFullName: string | null
): Promise<CancelBookingResult> {
  const startTime = shift.start_time || "08:00:00";
  const shiftDatetime = new Date(`${shift.shift_date}T${startTime}`);
  const now = new Date();
  const hoursUntilShift = (shiftDatetime.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isLateCancel = hoursUntilShift < 48;
  const isVeryLateCancel = hoursUntilShift <= 12;

  const { error } = await supabase
    .from("shift_bookings")
    .update({
      booking_status: "cancelled",
      cancelled_at: new Date().toISOString(),
      ...(isVeryLateCancel ? { late_cancel_notified: true } : {}),
    })
    .eq("id", bookingId);

  if (error) return { ok: false, error: error.message, isLateCancel };

  if (isVeryLateCancel) {
    try {
      const { data: coords } = await supabase
        .from("department_coordinators")
        .select("coordinator_id")
        .eq("department_id", shift.department_id);

      if (coords && coords.length > 0) {
        const shiftDateFormatted = format(new Date(shift.shift_date), "MMM d, yyyy");
        const notifications = coords.map((c) => ({
          user_id: c.coordinator_id,
          type: "late_cancellation",
          title: "Late Cancellation Alert",
          message: `${profileFullName} cancelled their booking for ${shift.title} on ${shiftDateFormatted} at ${startTime.slice(0, 5)} — less than 12 hours before the shift.`,
        }));
        await supabase.from("notifications").insert(notifications);
      }
    } catch {
      // Don't block the cancellation flow if notification fails.
    }
  }

  return { ok: true, isLateCancel };
}
