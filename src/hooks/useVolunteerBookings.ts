import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isUpcoming } from "@/lib/shift-lifecycle";
import type { User } from "@supabase/supabase-js";

/**
 * The shape of a single shift_bookings row joined with its parent shift +
 * department, as returned by the dashboard's combined PostgREST select.
 *
 * The supabase generated `Database` types don't model embedded selects
 * cleanly, so the hook applies a single `as any` cast at the assignment
 * boundary (see comment in fetchBookings). New code in this module is
 * fully typed against this interface.
 */
export interface VolunteerBooking {
  id: string;
  booking_status: string;
  confirmation_status: string;
  checked_in_at: string | null;
  waitlist_offer_expires_at: string | null;
  created_at: string;
  time_slot_id?: string | null;
  shifts: {
    id: string;
    title: string;
    shift_date: string;
    time_type: string;
    start_time: string | null;
    end_time: string | null;
    total_slots: number;
    booked_slots: number;
    requires_bg_check: boolean;
    status: string;
    allows_group: boolean;
    department_id: string;
    departments: { name: string; location_id: string; requires_bg_check?: boolean } | null;
  } | null;
}

export interface PendingConfirmation {
  id: string;
  booking_id: string;
  self_confirm_status: string;
  shift_bookings: {
    id: string;
    shifts: { title: string; shift_date: string; departments: { name: string } | null } | null;
  } | null;
}

interface UseVolunteerBookingsResult {
  upcoming: VolunteerBooking[];
  pendingConfirmations: PendingConfirmation[];
  waitlistOffers: VolunteerBooking[];
  waitlistPassive: VolunteerBooking[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Drop a booking from `upcoming` without refetching (post-cancel). */
  optimisticRemoveUpcoming: (bookingId: string) => void;
  /** Patch one booking in `upcoming` (post-checkin). */
  optimisticUpdateUpcoming: (bookingId: string, patch: Partial<VolunteerBooking>) => void;
}

/**
 * Loads and partitions the bookings shown on VolunteerDashboard:
 *   - upcoming: confirmed + future + not-cancelled (via isUpcoming())
 *   - waitlistOffers: waitlisted with an active offer expiry
 *   - waitlistPassive: waitlisted without an active offer, future date
 *   - pendingConfirmations: separate volunteer_shift_reports query
 *
 * `today` is taken as a parameter (not computed inside) so callers can
 * use the same LOCAL-date string used elsewhere — UTC drift in the evening
 * Central time would otherwise drop today's shifts from the upcoming list.
 */
export function useVolunteerBookings(user: User | null, today: string): UseVolunteerBookingsResult {
  const [upcoming, setUpcoming] = useState<VolunteerBooking[]>([]);
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([]);
  const [waitlistOffers, setWaitlistOffers] = useState<VolunteerBooking[]>([]);
  const [waitlistPassive, setWaitlistPassive] = useState<VolunteerBooking[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      // Avoiding PostgREST .or() with ISO timestamps because it silently fails
      // on some special-character combinations. Single combined query, split
      // client-side.
      const [{ data, error: bookingsErr }, { data: pendingData }] = await Promise.all([
        supabase
          .from("shift_bookings")
          .select("id, booking_status, confirmation_status, checked_in_at, waitlist_offer_expires_at, created_at, shifts(id, title, shift_date, time_type, start_time, end_time, total_slots, booked_slots, requires_bg_check, status, allows_group, department_id, departments(name, location_id))")
          .eq("volunteer_id", user.id)
          .in("booking_status", ["confirmed", "waitlisted"])
          .order("created_at", { ascending: false }),
        supabase
          .from("volunteer_shift_reports")
          .select("id, booking_id, self_confirm_status, shift_bookings(id, shifts(title, shift_date, departments(name)))")
          .eq("volunteer_id", user.id)
          .eq("self_confirm_status", "pending")
          .is("submitted_at", null),
      ]);
      if (bookingsErr) {
        console.error("useVolunteerBookings: fetch error:", bookingsErr);
      }

      // Single boundary cast — PostgREST embedded-select types vs generated
      // Database types diverge here. Same pattern documented in
      // eslint.config.js for (supabase as any).rpc().
      const all: VolunteerBooking[] = ((data as any[]) || []) as VolunteerBooking[];
      const nowMs = Date.now();

      const upcomingNew = all.filter(
        (b) =>
          b.booking_status === "confirmed" &&
          b.shifts &&
          isUpcoming(b.shifts) &&
          b.shifts.status !== "cancelled"
      );

      const offers = all.filter(
        (b) =>
          b.booking_status === "waitlisted" &&
          b.waitlist_offer_expires_at &&
          new Date(b.waitlist_offer_expires_at).getTime() > nowMs
      );

      const passive = all.filter(
        (b) =>
          b.booking_status === "waitlisted" &&
          (!b.waitlist_offer_expires_at ||
            new Date(b.waitlist_offer_expires_at).getTime() <= nowMs) &&
          b.shifts &&
          b.shifts.shift_date >= today
      );

      setUpcoming(upcomingNew);
      setWaitlistOffers(offers);
      setWaitlistPassive(passive);
      setPendingConfirmations(((pendingData as any[]) || []) as PendingConfirmation[]);
    } catch (e) {
      console.error("useVolunteerBookings: fatal error:", e);
    } finally {
      setLoading(false);
    }
  }, [user, today]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const optimisticRemoveUpcoming = useCallback((bookingId: string) => {
    setUpcoming((prev) => prev.filter((b) => b.id !== bookingId));
  }, []);

  const optimisticUpdateUpcoming = useCallback((bookingId: string, patch: Partial<VolunteerBooking>) => {
    setUpcoming((prev) => prev.map((b) => (b.id === bookingId ? { ...b, ...patch } : b)));
  }, []);

  return {
    upcoming,
    pendingConfirmations,
    waitlistOffers,
    waitlistPassive,
    loading,
    refresh,
    optimisticRemoveUpcoming,
    optimisticUpdateUpcoming,
  };
}
