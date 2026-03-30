import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Shield, Award, UserPlus } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { downloadICS, googleCalendarUrl, timeLabel } from "@/lib/calendar-utils";
import { InviteFriendModal } from "@/components/InviteFriendModal";
import { BookedSlotsDisplay } from "@/components/BookedSlotsDisplay";

export default function VolunteerDashboard() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [upcomingBookings, setUpcomingBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingConfirmations, setPendingConfirmations] = useState<any[]>([]);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    if (!user) return;
    const fetchBookings = async () => {
      const { data } = await supabase
        .from("shift_bookings")
        .select("id, booking_status, confirmation_status, checked_in_at, shifts(id, title, shift_date, time_type, start_time, end_time, total_slots, booked_slots, requires_bg_check, status, allows_group, department_id, departments(name, location_id))")
        .eq("volunteer_id", user.id)
        .eq("booking_status", "confirmed")
        .gte("shifts.shift_date", today)
        .order("created_at", { ascending: true });
      setUpcomingBookings((data as any) || []);
      setLoading(false);
    };
    fetchBookings();
  }, [user]);

  const handleCancel = async (bookingId: string, shift: any) => {
    const shiftDate = shift.shift_date;
    const startTime = shift.start_time || "08:00:00";
    const shiftDatetime = new Date(`${shiftDate}T${startTime}`);
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
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // Late cancellation notifications (within 12 hours)
    if (isVeryLateCancel) {
      try {
        // Find coordinators for this shift's department
        const { data: coords } = await supabase
          .from("department_coordinators")
          .select("coordinator_id")
          .eq("department_id", shift.department_id);

        if (coords && coords.length > 0) {
          const shiftDateFormatted = format(new Date(shiftDate), "MMM d, yyyy");
          const notifications = coords.map((c) => ({
            user_id: c.coordinator_id,
            type: "late_cancellation",
            title: "Late Cancellation Alert",
            message: `${profile?.full_name} cancelled their booking for ${shift.title} on ${shiftDateFormatted} at ${startTime.slice(0, 5)} — less than 12 hours before the shift.`,
          }));
          await supabase.from("notifications").insert(notifications);
        }
      } catch (e) {
        // Don't block the cancellation flow if notification fails
      }
    }

    setUpcomingBookings((prev) => prev.filter((b) => b.id !== bookingId));
    toast({
      title: "Shift cancelled",
      description: isLateCancel ? "Late cancellation (within 48 hours) may affect your consistency score." : "Cancelled successfully.",
    });
  };

  const handleCheckIn = async (bookingId: string) => {
    const { error } = await supabase
      .from("shift_bookings")
      .update({ checked_in_at: new Date().toISOString() })
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setUpcomingBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, checked_in_at: new Date().toISOString() } : b));
      toast({ title: "Checked in!" });
    }
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

  const milestoneBadges = [10, 25, 50, 100];
  const hours = profile?.total_hours ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {profile?.full_name?.split(" ")[0]}</h2>
        <p className="text-muted-foreground">Here are your upcoming shifts</p>
      </div>

      <OnboardingChecklist />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{upcomingBookings.filter(b => b.shifts).length}</div>
            <p className="text-sm text-muted-foreground">Upcoming Shifts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{hours}</div>
            <p className="text-sm text-muted-foreground">Total Hours</p>
            <div className="flex gap-1 mt-2">
              {milestoneBadges.map((m) => (
                <Badge key={m} variant={hours >= m ? "default" : "secondary"} className="text-[10px]">
                  {hours >= m && <Award className="h-2.5 w-2.5 mr-0.5" />}{m}h
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{profile?.consistency_score ?? 0}%</div>
            <p className="text-sm text-muted-foreground">Consistency Score</p>
            <p className="text-xs text-muted-foreground mt-1">Based on last 5 shifts</p>
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
              const isToday = s.shift_date === today;
              const alreadyCheckedIn = !!booking.checked_in_at;
              return (
                <Card key={booking.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-medium">{s.title}</div>
                        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.departments?.name}</span>
                        </div>
                        <div className="flex gap-2">
                          {s.requires_bg_check && <Badge variant="outline" className="text-xs"><Shield className="h-3 w-3 mr-1" />BG Check</Badge>}
                          {booking.confirmation_status === "confirmed" && <Badge className="text-xs bg-success text-success-foreground">Confirmed</Badge>}
                          {booking.confirmation_status === "pending_confirmation" && <Badge variant="secondary" className="text-xs">Pending</Badge>}
                        </div>
                        <BookedSlotsDisplay bookingId={booking.id} />
                      </div>
                      <div className="flex flex-col gap-2 sm:items-end">
                        {isToday && !alreadyCheckedIn && (
                          <Button size="sm" onClick={() => handleCheckIn(booking.id)}>Check In</Button>
                        )}
                        {alreadyCheckedIn && <Badge className="text-xs bg-success text-success-foreground">Checked In</Badge>}
                        <div className="flex gap-1 flex-wrap">
                          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => downloadICS(s)} aria-label="Download iCal">
                            📅 iCal
                          </Button>
                          <Button variant="ghost" size="sm" className="text-xs h-7" asChild>
                            <a href={googleCalendarUrl(s)} target="_blank" rel="noopener noreferrer" aria-label="Add to Google Calendar">
                              📆 Google
                            </a>
                          </Button>
                          {!s.requires_bg_check && (
                            <InviteFriendModal shiftId={s.id} shiftTitle={s.title} />
                          )}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => handleCancel(booking.id, s)}>Cancel</Button>
                      </div>
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
