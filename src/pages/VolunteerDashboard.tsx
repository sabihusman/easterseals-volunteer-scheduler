import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Shield, Users } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type ShiftWithDept = {
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
  departments?: { name: string; location_id: string } | null;
};

type Booking = {
  id: string;
  booking_status: string;
  confirmation_status: string;
  shifts: ShiftWithDept | null;
};

export default function VolunteerDashboard() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchBookings = async () => {
      const { data } = await supabase
        .from("shift_bookings")
        .select("id, booking_status, confirmation_status, shifts(id, title, shift_date, time_type, start_time, end_time, total_slots, booked_slots, requires_bg_check, status, allows_group, department_id, departments(name, location_id))")
        .eq("volunteer_id", user.id)
        .eq("booking_status", "confirmed")
        .gte("shifts.shift_date", new Date().toISOString().split("T")[0])
        .order("created_at", { ascending: true });
      setUpcomingBookings((data as any) || []);
      setLoading(false);
    };
    fetchBookings();
  }, [user]);

  const handleCancel = async (bookingId: string) => {
    const { error } = await supabase
      .from("shift_bookings")
      .update({ booking_status: "cancelled" })
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setUpcomingBookings((prev) => prev.filter((b) => b.id !== bookingId));
      toast({ title: "Shift cancelled" });
    }
  };

  const timeLabel = (s: ShiftWithDept) => {
    if (s.time_type === "custom" && s.start_time && s.end_time) return `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}`;
    return s.time_type.charAt(0).toUpperCase() + s.time_type.slice(1);
  };

  if (!profile?.is_active) {
    return (
      <div className="max-w-lg mx-auto mt-12 text-center">
        <Card>
          <CardHeader>
            <CardTitle>Account Pending</CardTitle>
            <CardDescription>Your account is pending activation by an administrator. You'll be notified once approved.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {profile?.full_name?.split(" ")[0]}</h2>
        <p className="text-muted-foreground">Here are your upcoming shifts</p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{upcomingBookings.filter(b => b.shifts).length}</div>
            <p className="text-sm text-muted-foreground">Upcoming Shifts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{profile?.total_hours ?? 0}</div>
            <p className="text-sm text-muted-foreground">Total Hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{profile?.consistency_score ?? 0}%</div>
            <p className="text-sm text-muted-foreground">Consistency Score</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Upcoming Shifts</h3>
        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : upcomingBookings.filter(b => b.shifts).length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <p>No upcoming shifts. <a href="/shifts" className="text-primary underline">Browse available shifts</a></p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {upcomingBookings.filter(b => b.shifts).map((booking) => {
              const s = booking.shifts!;
              return (
                <Card key={booking.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-medium">{s.title}</div>
                        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s as any)}</span>
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{(s as any).departments?.name}</span>
                        </div>
                        <div className="flex gap-2">
                          {s.requires_bg_check && <Badge variant="outline" className="text-xs"><Shield className="h-3 w-3 mr-1" />BG Check</Badge>}
                          {booking.confirmation_status === "confirmed" && <Badge className="text-xs bg-success text-success-foreground">Confirmed</Badge>}
                          {booking.confirmation_status === "pending_confirmation" && <Badge variant="secondary" className="text-xs">Pending</Badge>}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => handleCancel(booking.id)}>Cancel</Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
