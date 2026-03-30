import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Star } from "lucide-react";
import { format } from "date-fns";
import { BookedSlotsDisplay } from "@/components/BookedSlotsDisplay";
import { CoordinatorHoursConfirmation } from "@/components/CoordinatorHoursConfirmation";

interface Props {
  departmentIds: string[];
}

export function VolunteerActivityTab({ departmentIds }: Props) {
  const [bookings, setBookings] = useState<any[]>([]);
  const [shiftRatings, setShiftRatings] = useState<Record<string, { avg: number; count: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (departmentIds.length === 0) return;
    const fetchActivity = async () => {
      const { data } = await supabase
        .from("shift_bookings")
        .select("id, booking_status, confirmation_status, checked_in_at, created_at, volunteer_reported_hours, coordinator_reported_hours, final_hours, hours_source, shift_id, profiles!shift_bookings_volunteer_id_fkey(full_name, email), shifts!shift_bookings_shift_id_fkey(title, shift_date, time_type, start_time, end_time, department_id)")
        .in("booking_status", ["confirmed", "waitlisted"])
        .order("created_at", { ascending: false })
        .limit(200);
      const filtered = (data || []).filter((b: any) => b.shifts && departmentIds.includes(b.shifts.department_id));
      setBookings(filtered);

      // Fetch aggregate ratings for shifts in these departments
      const shiftIds = [...new Set(filtered.map((b: any) => b.shift_id))];
      if (shiftIds.length > 0) {
        const { data: reports } = await supabase
          .from("volunteer_shift_reports")
          .select("booking_id, star_rating")
          .not("star_rating", "is", null);
        
        // Map booking_id to shift_id
        const bookingToShift = new Map(filtered.map((b: any) => [b.id, b.shift_id]));
        const ratingsByShift: Record<string, number[]> = {};
        for (const r of reports || []) {
          const sid = bookingToShift.get(r.booking_id);
          if (sid) {
            if (!ratingsByShift[sid]) ratingsByShift[sid] = [];
            ratingsByShift[sid].push(r.star_rating!);
          }
        }
        const avgMap: Record<string, { avg: number; count: number }> = {};
        for (const [sid, ratings] of Object.entries(ratingsByShift)) {
          avgMap[sid] = { avg: +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1), count: ratings.length };
        }
        setShiftRatings(avgMap);
      }

      setLoading(false);
    };
    fetchActivity();
  }, [departmentIds]);

  const today = new Date().toISOString().split("T")[0];
  const upcoming = bookings.filter((b: any) => b.shifts?.shift_date >= today);
  const past = bookings.filter((b: any) => b.shifts?.shift_date < today);

  const statusBadge = (status: string) => {
    switch (status) {
      case "confirmed": return <Badge className="text-xs bg-success text-success-foreground">Confirmed</Badge>;
      case "no_show": return <Badge variant="destructive" className="text-xs">No Show</Badge>;
      case "pending_confirmation": return <Badge variant="secondary" className="text-xs">Pending</Badge>;
      default: return <Badge variant="secondary" className="text-xs">{status.replace("_", " ")}</Badge>;
    }
  };

  const handleHoursUpdate = (bookingId: string, hours: number) => {
    setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, coordinator_reported_hours: hours } : b));
  };

  const BookingRow = ({ b, showHoursConfirm }: { b: any; showHoursConfirm: boolean }) => {
    const rating = shiftRatings[b.shift_id];
    return (
      <div className="flex flex-col gap-2 py-2 px-3 rounded-md bg-muted/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">{b.profiles?.full_name}</div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{b.shifts?.title}</span>
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{b.shifts?.shift_date ? format(new Date(b.shifts.shift_date), "MMM d, yyyy") : ""}</span>
              {rating && (
                <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" />★ {rating.avg} avg ({rating.count} rating{rating.count !== 1 ? "s" : ""})</span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex gap-2 items-center">
              <Badge variant="outline" className="text-xs">{b.booking_status}</Badge>
              {statusBadge(b.confirmation_status)}
              {b.checked_in_at && <Badge className="text-xs bg-success text-success-foreground">Checked In</Badge>}
            </div>
            <BookedSlotsDisplay bookingId={b.id} compact />
          </div>
        </div>
        {showHoursConfirm && (
          <CoordinatorHoursConfirmation booking={b} onUpdate={handleHoursUpdate} />
        )}
      </div>
    );
  };

  if (loading) return <p className="text-muted-foreground">Loading activity...</p>;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-medium text-sm mb-2">Upcoming Bookings ({upcoming.length})</h4>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming bookings.</p>
        ) : (
          <div className="space-y-1">
            {upcoming.map((b) => <BookingRow key={b.id} b={b} showHoursConfirm={false} />)}
          </div>
        )}
      </div>
      <div>
        <h4 className="font-medium text-sm mb-2">Past Activity ({past.length})</h4>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No past activity.</p>
        ) : (
          <div className="space-y-1">
            {past.slice(0, 50).map((b) => <BookingRow key={b.id} b={b} showHoursConfirm={true} />)}
          </div>
        )}
      </div>
    </div>
  );
}
