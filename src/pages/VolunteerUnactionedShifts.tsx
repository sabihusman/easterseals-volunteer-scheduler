import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Building2, CheckCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { timeLabel, parseShiftDate } from "@/lib/calendar-utils";

interface UnactionedBooking {
  id: string;
  booking_status: string;
  confirmation_status: string;
  checked_in_at: string | null;
  shifts: {
    id: string;
    title: string;
    shift_date: string;
    time_type: string;
    start_time: string | null;
    end_time: string | null;
    departments: { name: string } | null;
  };
}

export default function VolunteerUnactionedShifts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<UnactionedBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      // Fetch confirmed bookings that haven't been actioned (still
      // pending_confirmation) for shifts that have already ended.
      const today = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase
        .from("shift_bookings")
        .select(
          "id, booking_status, confirmation_status, checked_in_at, shifts!shift_bookings_shift_id_fkey(id, title, shift_date, time_type, start_time, end_time, departments(name))"
        )
        .eq("volunteer_id", user.id)
        .eq("booking_status", "confirmed")
        .eq("confirmation_status", "pending_confirmation")
        .order("created_at", { ascending: false });

      if (data) {
        // Client-side filter: only include shifts whose end time has
        // already passed. We need this because PostgREST can't
        // compare shift_date + end_time < now() in a single filter.
        const now = new Date();
        const ended = (data as unknown as UnactionedBooking[]).filter((b) => {
          if (!b.shifts) return false;
          const endStr =
            b.shifts.end_time ||
            (b.shifts.time_type === "morning"
              ? "12:00:00"
              : b.shifts.time_type === "afternoon"
              ? "16:00:00"
              : "17:00:00");
          const endAt = new Date(`${b.shifts.shift_date}T${endStr}`);
          return endAt < now;
        });
        setBookings(ended);
      }
      setLoading(false);
    };
    fetch();
  }, [user]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <AlertCircle className="h-6 w-6 text-warning" />
          Unactioned Shifts
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          These shifts have ended but you haven't confirmed your attendance yet.
          Please confirm each one so your volunteer hours are recorded.
        </p>
      </div>

      {bookings.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            <CheckCircle className="h-10 w-10 text-success mx-auto" />
            <p className="text-muted-foreground">
              All caught up! No shifts awaiting confirmation.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate("/dashboard")}
            >
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {bookings.map((b) => (
            <Card key={b.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="font-medium">{b.shifts.title}</div>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(
                          parseShiftDate(b.shifts.shift_date),
                          "MMM d, yyyy"
                        )}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {timeLabel(b.shifts)}
                      </span>
                      {b.shifts.departments?.name && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          {b.shifts.departments.name}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {b.checked_in_at ? (
                        <Badge className="bg-primary/10 text-primary text-xs">
                          Checked In
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs text-warning border-warning"
                        >
                          Not Checked In
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="text-xs text-warning border-warning"
                      >
                        Pending Confirmation
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate(`/my-shifts/confirm/${b.id}`)
                    }
                  >
                    Confirm Now
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
