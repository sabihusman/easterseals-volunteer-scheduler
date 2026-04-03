import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Loader2,
  Clock,
  CalendarDays,
  PartyPopper,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WaitlistBooking {
  id: string;
  shift_id: string;
  volunteer_id: string;
  status: "waitlisted" | "confirmed" | "cancelled";
  created_at: string;
  /** Position on the waitlist (1-indexed). Only relevant when status = waitlisted. */
  position?: number;
  /** Whether the user was recently promoted from waitlist → confirmed. */
  justPromoted?: boolean;
  shifts?: {
    shift_date: string;
    start_time: string;
    end_time: string;
    departments?: { name: string };
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WaitlistStatus() {
  const [bookings, setBookings] = useState<WaitlistBooking[]>([]);
  const [promoted, setPromoted] = useState<WaitlistBooking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    /*
     * 1. Fetch the current user's waitlisted bookings with shift info.
     */
    const { data: mine } = await supabase
      .from("bookings")
      .select(
        "id, shift_id, volunteer_id, status, created_at, shifts(shift_date, start_time, end_time, departments(name))"
      )
      .eq("volunteer_id", user.id)
      .eq("status", "waitlisted")
      .order("created_at", { ascending: true });

    /*
     * 2. For each waitlisted booking, figure out the user's position by
     *    counting how many waitlisted bookings for the same shift were
     *    created before (or at the same time) as this one.
     */
    const enriched: WaitlistBooking[] = [];

    if (mine && mine.length > 0) {
      const shiftIds = [...new Set(mine.map((b) => b.shift_id))];

      // Fetch all waitlisted bookings for these shifts to compute position
      const { data: allWaitlisted } = await supabase
        .from("bookings")
        .select("id, shift_id, created_at")
        .in("shift_id", shiftIds)
        .eq("status", "waitlisted")
        .order("created_at", { ascending: true });

      const positionMap = new Map<string, number>();
      if (allWaitlisted) {
        // Group by shift, sort by created_at, then assign positions
        const byShift = new Map<string, typeof allWaitlisted>();
        for (const row of allWaitlisted) {
          const list = byShift.get(row.shift_id) ?? [];
          list.push(row);
          byShift.set(row.shift_id, list);
        }
        for (const [, list] of byShift) {
          list.sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          list.forEach((row, idx) => positionMap.set(row.id, idx + 1));
        }
      }

      for (const b of mine) {
        enriched.push({
          ...(b as unknown as WaitlistBooking),
          position: positionMap.get(b.id) ?? 1,
        });
      }
    }

    setBookings(enriched);

    /*
     * 3. Check for recently-promoted bookings (confirmed in the last 24 h
     *    that were originally waitlisted — we detect this by the presence
     *    of a `promoted_at` column or by checking a notifications table).
     *
     *    Simple heuristic: fetch confirmed bookings updated in last 24 h
     *    that have a `waitlisted_at` timestamp (or created before today).
     */
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentConfirmed } = await supabase
      .from("bookings")
      .select(
        "id, shift_id, volunteer_id, status, created_at, shifts(shift_date, start_time, end_time, departments(name))"
      )
      .eq("volunteer_id", user.id)
      .eq("status", "confirmed")
      .gte("updated_at", oneDayAgo)
      .not("promoted_at", "is", null);

    if (recentConfirmed) {
      setPromoted(
        (recentConfirmed as unknown as WaitlistBooking[]).map((b) => ({
          ...b,
          justPromoted: true,
        }))
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[#006B3E]" />
      </div>
    );
  }

  if (bookings.length === 0 && promoted.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* ---- Promotion banner ---- */}
      {promoted.map((b) => (
        <div
          key={b.id}
          className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4"
        >
          <PartyPopper className="h-5 w-5 shrink-0 text-[#006B3E]" />
          <div>
            <p className="text-sm font-semibold text-[#006B3E]">
              A spot opened up! You've been moved from the waitlist.
            </p>
            <p className="text-sm text-gray-700">
              {b.shifts?.departments?.name ?? "Shift"} on{" "}
              {b.shifts?.shift_date} ({b.shifts?.start_time?.slice(0, 5)} –{" "}
              {b.shifts?.end_time?.slice(0, 5)})
            </p>
          </div>
        </div>
      ))}

      {/* ---- Waitlisted bookings ---- */}
      {bookings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-gray-800">
              <Clock className="h-4 w-4 text-amber-500" />
              Waitlist
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {bookings.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-gray-900">
                      {b.shifts?.departments?.name ?? "Shift"}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {b.shifts?.shift_date}
                      </span>
                      <span>
                        {b.shifts?.start_time?.slice(0, 5)} –{" "}
                        {b.shifts?.end_time?.slice(0, 5)}
                      </span>
                    </div>
                  </div>

                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-amber-700"
                  >
                    Position #{b.position}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
