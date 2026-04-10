import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Shield, Award, UserPlus, AlertTriangle, XCircle, ChevronDown, CheckCircle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { format, differenceInHours } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { downloadICS, googleCalendarUrl, timeLabel, generateICS } from "@/lib/calendar-utils";
import { formatSlotRange, slotHours } from "@/lib/slot-utils";
import { InviteFriendModal } from "@/components/InviteFriendModal";
import { BookedSlotsDisplay } from "@/components/BookedSlotsDisplay";
import { VolunteerImpactCharts } from "@/components/VolunteerImpactCharts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export default function VolunteerDashboard() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [upcomingBookings, setUpcomingBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingConfirmations, setPendingConfirmations] = useState<any[]>([]);
  const [waitlistOffers, setWaitlistOffers] = useState<any[]>([]);
  const [waitlistPassive, setWaitlistPassive] = useState<any[]>([]);

  // Use LOCAL date, not UTC — otherwise in the evening Central time the UTC
  // rollover drops today's shifts from the filter and they disappear from the
  // dashboard until the next calendar day.
  const today = format(new Date(), "yyyy-MM-dd");

  const fetchBookings = useCallback(async () => {
    if (!user) return;
    try {
      // Fetch CONFIRMED and WAITLISTED bookings in a single query; we split
      // them client-side. Avoiding PostgREST .or() with ISO timestamps
      // because it silently fails on some special-character combinations.
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
        console.error("fetchBookings error:", bookingsErr);
      }

      const all = (data as any[]) || [];
      const nowMs = Date.now();

      // Upcoming (confirmed) shifts: today or future, not admin-cancelled
      const upcoming = all.filter(
        (b) =>
          b.booking_status === "confirmed" &&
          b.shifts &&
          b.shifts.shift_date >= today &&
          b.shifts.status !== "cancelled"
      );

      // Active waitlist offers
      const offers = all.filter(
        (b) =>
          b.booking_status === "waitlisted" &&
          b.waitlist_offer_expires_at &&
          new Date(b.waitlist_offer_expires_at).getTime() > nowMs
      );

      // Passive waitlist (no active offer) for future shifts
      const passive = all.filter(
        (b) =>
          b.booking_status === "waitlisted" &&
          (!b.waitlist_offer_expires_at ||
            new Date(b.waitlist_offer_expires_at).getTime() <= nowMs) &&
          b.shifts &&
          b.shifts.shift_date >= today
      );

      setUpcomingBookings(upcoming);
      setWaitlistOffers(offers);
      setWaitlistPassive(passive);
      setPendingConfirmations((pendingData as any) || []);
    } catch (e) {
      console.error("fetchBookings fatal error:", e);
    } finally {
      setLoading(false);
    }
  }, [user, today]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const handleWaitlistAccept = async (bookingId: string) => {
    const { error } = await (supabase as any).rpc("waitlist_accept", { p_booking_id: bookingId });
    if (error) {
      toast({ title: "Could not accept", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Shift confirmed!", description: "You're booked." });
    }
    fetchBookings();
  };

  const handleWaitlistDecline = async (bookingId: string) => {
    const ok = window.confirm("Decline this waitlist offer? Your spot will move to the next volunteer.");
    if (!ok) return;
    const { error } = await (supabase as any).rpc("waitlist_decline", { p_booking_id: bookingId });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Offer declined" });
    }
    fetchBookings();
  };

  const handleLeaveWaitlist = async (bookingId: string) => {
    const ok = window.confirm("Leave the waitlist for this shift? You can rejoin later if spots are still open.");
    if (!ok) return;
    const { error } = await supabase
      .from("shift_bookings")
      .delete()
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Left the waitlist" });
    }
    fetchBookings();
  };

  const handleCancel = async (bookingId: string, shift: any) => {
    const shiftDate = shift.shift_date;
    const startTime = shift.start_time || "08:00:00";
    const shiftDatetime = new Date(`${shiftDate}T${startTime}`);
    const now = new Date();
    const hoursUntilShift = (shiftDatetime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isLateCancel = hoursUntilShift < 48;
    const isVeryLateCancel = hoursUntilShift <= 12;

    // Verify the booking still exists before trying to cancel — if admin
    // hard-deleted the shift, the booking was cascaded away and any update
    // would silently match 0 rows.
    const { data: existing, error: checkError } = await supabase
      .from("shift_bookings")
      .select("id, booking_status")
      .eq("id", bookingId)
      .maybeSingle();

    if (checkError || !existing) {
      toast({
        title: "Shift no longer exists",
        description: "This shift was removed by an administrator. Refreshing your list.",
        variant: "destructive",
      });
      // Drop the stale row from state so the UI matches reality
      setUpcomingBookings((prev) => prev.filter((b) => b.id !== bookingId));
      return;
    }

    if (existing.booking_status !== "confirmed") {
      toast({
        title: "Already cancelled",
        description: "This booking is no longer active.",
      });
      setUpcomingBookings((prev) => prev.filter((b) => b.id !== bookingId));
      return;
    }

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

  const handleCheckIn = async (bookingId: string, shift: any) => {
    if (shift?.shift_date !== today) {
      toast({ title: "Not today", description: "You can only check in on the day of your shift.", variant: "destructive" });
      return;
    }

    // Only allow check-in within the 30-minute pre-shift window (or later).
    // Use time_type defaults when start_time is null.
    const startStr =
      shift.start_time ||
      (shift.time_type === "morning"
        ? "09:00:00"
        : shift.time_type === "afternoon"
        ? "13:00:00"
        : "09:00:00");
    const shiftStart = new Date(`${shift.shift_date}T${startStr}`);
    const endStr =
      shift.end_time ||
      (shift.time_type === "morning"
        ? "12:00:00"
        : shift.time_type === "afternoon"
        ? "16:00:00"
        : "17:00:00");
    const shiftEnd = new Date(`${shift.shift_date}T${endStr}`);
    const now = new Date();
    const minutesToStart = (shiftStart.getTime() - now.getTime()) / 60000;
    if (minutesToStart > 30) {
      toast({
        title: "Too early",
        description: `Check-in opens 30 minutes before the shift starts (${Math.ceil(minutesToStart - 30)} minute${minutesToStart - 30 >= 2 ? "s" : ""} from now).`,
        variant: "destructive",
      });
      return;
    }
    if (now > shiftEnd) {
      toast({
        title: "Shift ended",
        description: "This shift has already ended. Use the shift confirmation flow instead.",
        variant: "destructive",
      });
      return;
    }

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

    const privilegesSuspended = profile?.booking_privileges === false;
    const bgFailed = profile?.bg_check_status === "failed" || profile?.bg_check_status === "expired";

    // Filter upcoming bookings based on eligibility
    const eligibleBookings = upcomingBookings.filter(b => {
      if (!b.shifts) return false;
      if (privilegesSuspended) return false;
      if (bgFailed && (b.shifts.requires_bg_check || b.shifts.departments?.requires_bg_check)) return false;
      return true;
    });

    return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Welcome back, {profile?.full_name?.split(" ")[0]}</h2>
        <p className="text-muted-foreground">Here are your upcoming shifts</p>
      </div>

      {privilegesSuspended && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Booking Privileges Suspended</AlertTitle>
          <AlertDescription>Your booking privileges have been suspended. Please contact your coordinator.</AlertDescription>
        </Alert>
      )}

      {!privilegesSuspended && bgFailed && (
        <Alert className="border-warning/50 bg-warning/10 text-warning-foreground">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Background Check {profile?.bg_check_status === "expired" ? "Expired" : "Failed"}</AlertTitle>
          <AlertDescription>Your background check status is {profile?.bg_check_status}. You cannot book shifts that require a background check until this is resolved.</AlertDescription>
        </Alert>
      )}

      {!(profile as any)?.emergency_contact_name || !(profile as any)?.emergency_contact_phone ? (
        <Alert className="border-warning/50 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle>Emergency Contact Required</AlertTitle>
          <AlertDescription>
            Please add an emergency contact before booking shifts. This is required for insurance and liability.{" "}
            <a href="/settings" className="text-primary font-medium underline">Go to Settings →</a>
          </AlertDescription>
        </Alert>
      ) : null}



      {pendingConfirmations.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-medium">
                You have <span className="font-bold text-primary">{pendingConfirmations.length}</span> shift{pendingConfirmations.length !== 1 ? "s" : ""} awaiting your confirmation.
              </p>
              <a href={`/my-shifts/confirm/${pendingConfirmations[0]?.booking_id}`} className="text-sm font-medium text-primary hover:underline">
                Confirm now →
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {waitlistOffers.length > 0 && waitlistOffers.map((offer) => {
        const s = offer.shifts;
        const expiresAt = new Date(offer.waitlist_offer_expires_at);
        const minutesLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60000));
        return (
          <Card key={offer.id} className="border-amber-500/50 bg-amber-500/10">
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="font-semibold">Waitlist spot opened: {s?.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {s && format(new Date(s.shift_date + "T00:00:00"), "MMMM d, yyyy")}
                    {s?.departments?.name ? ` · ${s.departments.name}` : ""}
                  </p>
                  <p className="text-xs text-amber-700">
                    You have {minutesLeft >= 60
                      ? `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m`
                      : `${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}`} to respond.
                    The offer forfeits at {format(expiresAt, "h:mm a")}.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => handleWaitlistDecline(offer.id)}>
                  Decline
                </Button>
                <Button size="sm" onClick={() => handleWaitlistAccept(offer.id)}>
                  <CheckCircle className="h-4 w-4 mr-2" /> Accept Shift
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {waitlistPassive.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" /> Your Waitlist
            </CardTitle>
            <CardDescription className="text-xs">
              You'll be notified if a spot opens up on any of these shifts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {waitlistPassive.map((w) => {
              const s = w.shifts;
              return (
                <div key={w.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-md bg-muted/50">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{s?.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {s && format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")}
                      {s?.departments?.name ? ` · ${s.departments.name}` : ""}
                      {s && ` · ${s.booked_slots}/${s.total_slots} filled`}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleLeaveWaitlist(w.id)}>
                    Leave Waitlist
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{eligibleBookings.length}</div>
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
            <div className="text-2xl font-bold">
              {profile?.consistency_score != null ? `${profile.consistency_score}%` : "—"}
            </div>
            <p className="text-sm text-muted-foreground">Consistency Score</p>
            <p className="text-xs text-muted-foreground mt-1">
              {profile?.consistency_score != null
                ? "Based on last 5 shifts"
                : "Complete 5 shifts to see your score"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{profile?.volunteer_points || 0}</div>
            <p className="text-sm text-muted-foreground">Points</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Upcoming Shifts</h3>
        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : eligibleBookings.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <p>{privilegesSuspended ? "Your booking privileges are suspended." : "No upcoming shifts."} <a href="/shifts" className="text-primary underline">Browse available shifts</a></p>
            </CardContent>
          </Card>
        ) : (() => {
          // Group bookings by shift_id for per-slot display
          const groupedMap = new Map<string, any[]>();
          for (const b of eligibleBookings) {
            const sid = b.shifts?.id;
            if (!sid) continue;
            if (!groupedMap.has(sid)) groupedMap.set(sid, []);
            groupedMap.get(sid)!.push(b);
          }
          const groups = Array.from(groupedMap.values());

          return (
            <div className="grid gap-3">
              {groups.map((bookings) => {
                const firstBooking = bookings[0];
                const s = firstBooking.shifts!;
                const isToday = s.shift_date === today;
                const startStr = s.start_time || (s.time_type === "morning" ? "09:00:00" : s.time_type === "afternoon" ? "13:00:00" : "09:00:00");
                const endStr = s.end_time || (s.time_type === "morning" ? "12:00:00" : s.time_type === "afternoon" ? "16:00:00" : "17:00:00");
                const shiftStartMs = new Date(`${s.shift_date}T${startStr}`).getTime();
                const shiftEndMs = new Date(`${s.shift_date}T${endStr}`).getTime();
                const nowMs = Date.now();
                const checkInOpen = isToday && nowMs >= shiftStartMs - 30 * 60 * 1000 && nowMs <= shiftEndMs;
                const anyCheckedIn = bookings.some((b: any) => !!b.checked_in_at);

                return (
                  <Card key={s.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1 flex-1">
                          <div className="font-medium">{s.title}</div>
                          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")}</span>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.departments?.name}</span>
                          </div>
                          <div className="flex gap-2">
                            {s.requires_bg_check && <Badge variant="outline" className="text-xs"><Shield className="h-3 w-3 mr-1" />BG Check</Badge>}
                          </div>
                          {/* Per-slot bookings */}
                          <BookedSlotsDisplay shiftId={s.id} volunteerId={user?.id} />

                          {/* Individual slot actions */}
                          {bookings.length > 1 && (
                            <div className="space-y-1 mt-2 pl-2 border-l-2 border-muted">
                              {bookings.map((b: any) => (
                                <div key={b.id} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="text-muted-foreground">
                                    {b.time_slot_id ? "Slot booking" : "Full shift"}
                                  </span>
                                  <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={() => handleCancel(b.id, s)}>
                                    Cancel Slot
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 sm:items-end">
                          {checkInOpen && !anyCheckedIn && (
                            <Button size="sm" onClick={() => handleCheckIn(firstBooking.id, s)}>Check In</Button>
                          )}
                          {isToday && !anyCheckedIn && !checkInOpen && nowMs < shiftStartMs && (
                            <Badge variant="outline" className="text-xs">Check-in opens 30 min before start</Badge>
                          )}
                          {anyCheckedIn && <Badge className="text-xs bg-success text-success-foreground">Checked In</Badge>}
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
                              <InviteFriendModal shiftId={s.id} shiftTitle={s.title} shiftDate={s.shift_date} shiftTime={timeLabel(s)} />
                            )}
                          </div>
                          {bookings.length === 1 ? (
                            <Button variant="outline" size="sm" onClick={() => handleCancel(firstBooking.id, s)}>Cancel</Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => {
                              const ok = window.confirm(`Cancel all ${bookings.length} slot bookings for ${s.title}?`);
                              if (ok) bookings.forEach((b: any) => handleCancel(b.id, s));
                            }}>Cancel All Slots</Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          );
        })()}
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost">My Impact Over Time <ChevronDown className="ml-1 h-4 w-4" /></Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <VolunteerImpactCharts />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
