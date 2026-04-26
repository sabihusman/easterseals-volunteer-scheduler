import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VolunteerImpactCharts } from "@/components/volunteer/VolunteerImpactCharts";
import { getEffectiveTimes, minutesUntilStart } from "@/lib/shift-time";
import { useVolunteerBookings } from "@/hooks/useVolunteerBookings";
import { useShiftInvitations, type ShiftInvitation } from "@/hooks/useShiftInvitations";
import {
  planInvitationAcceptance,
  acceptInvitation as acceptInvitationAction,
  declineInvitation as declineInvitationAction,
  precheckCancel,
  cancelBooking as cancelBookingAction,
} from "@/lib/booking-actions";
import { PendingConfirmationsBanner } from "@/components/volunteer/PendingConfirmationsBanner";
import { WaitlistOfferCard } from "@/components/volunteer/WaitlistOfferCard";
import { PassiveWaitlistList } from "@/components/volunteer/PassiveWaitlistList";
import { InvitationConflictDialog, type InvitationConflict } from "@/components/volunteer/InvitationConflictDialog";
import { InvitationsList } from "@/components/volunteer/InvitationsList";
import { DashboardStats } from "@/components/volunteer/DashboardStats";
import { DashboardAlerts, type AlertProfile } from "@/components/volunteer/DashboardAlerts";
import { UpcomingShiftsSection } from "@/components/volunteer/UpcomingShiftsSection";
import type { ShiftActionTarget } from "@/components/volunteer/UpcomingShiftCard";

export default function VolunteerDashboard() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [invitationActioning, setInvitationActioning] = useState<string | null>(null);
  const [inviteConflict, setInviteConflict] = useState<InvitationConflict | null>(null);

  // Use LOCAL date, not UTC — otherwise in the evening Central time the UTC
  // rollover drops today's shifts from the filter and they disappear from the
  // dashboard until the next calendar day.
  const today = format(new Date(), "yyyy-MM-dd");

  const {
    upcoming: upcomingBookings,
    pendingConfirmations,
    waitlistOffers,
    waitlistPassive,
    loading,
    refresh: fetchBookings,
    optimisticRemoveUpcoming,
    optimisticUpdateUpcoming,
  } = useVolunteerBookings(user, today);

  const { invitations, refresh: fetchInvitations } = useShiftInvitations(user);

  const handleInvitationAccept = async (inv: ShiftInvitation) => {
    if (!user || !inv.shifts) return;
    setInvitationActioning(inv.id);

    const plan = await planInvitationAcceptance(inv, user.id);
    if (plan.kind === "fully_booked") {
      toast({
        title: "Shift fully booked",
        description: "This shift is now fully booked. Thank you for being available to help fill this spot.",
      });
      setInvitationActioning(null);
      fetchInvitations();
      return;
    }
    if (plan.kind === "conflict") {
      setInviteConflict({
        invitation: inv,
        conflictBookingId: plan.conflictBookingId,
        conflictShift: plan.conflictShift,
      });
      setInvitationActioning(null);
      return;
    }
    await completeInvitationAccept(inv);
  };

  const completeInvitationAccept = async (
    inv: ShiftInvitation,
    cancelBookingId?: string,
    cancelledShift?: { id: string; title: string; shift_date: string; department_id: string; departments: { name: string } | null }
  ) => {
    if (!user || !inv.shifts) return;
    setInvitationActioning(inv.id);

    const result = await acceptInvitationAction({
      invitation: inv,
      userId: user.id,
      profileFullName: profile?.full_name ?? null,
      cancelBookingId,
      cancelledShift: cancelledShift
        ? { ...cancelledShift, start_time: null, end_time: null }
        : undefined,
    });

    if (!result.ok) {
      toast({ title: "Could not book shift", description: result.error, variant: "destructive" });
      setInvitationActioning(null);
      return;
    }

    setInvitationActioning(null);
    setInviteConflict(null);
    toast({ title: "Shift confirmed!", description: `You're booked for ${inv.shifts.title}.` });
    fetchInvitations();
    fetchBookings();
  };

  const handleInvitationDecline = async (inv: ShiftInvitation, reason?: string) => {
    setInvitationActioning(inv.id);
    await declineInvitationAction({
      invitation: inv,
      profileFullName: profile?.full_name ?? null,
      reason,
    });
    setInvitationActioning(null);
    setInviteConflict(null);
    toast({ title: "Invitation declined" });
    fetchInvitations();
  };

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

  const handleCancel = async (bookingId: string, shift: ShiftActionTarget) => {
    const precheck = await precheckCancel(bookingId);
    if (precheck.kind === "missing") {
      toast({
        title: "Shift no longer exists",
        description: "This shift was removed by an administrator. Refreshing your list.",
        variant: "destructive",
      });
      optimisticRemoveUpcoming(bookingId);
      return;
    }
    if (precheck.kind === "already_cancelled") {
      toast({ title: "Already cancelled", description: "This booking is no longer active." });
      optimisticRemoveUpcoming(bookingId);
      return;
    }

    const result = await cancelBookingAction(bookingId, shift, profile?.full_name ?? null);
    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" });
      return;
    }

    optimisticRemoveUpcoming(bookingId);
    toast({
      title: "Shift cancelled",
      description: result.isLateCancel
        ? "Late cancellation (within 48 hours) may affect your consistency score."
        : "Cancelled successfully.",
    });
  };

  const handleCheckIn = async (bookingId: string, shift: ShiftActionTarget) => {
    if (shift?.shift_date !== today) {
      toast({ title: "Not today", description: "You can only check in on the day of your shift.", variant: "destructive" });
      return;
    }

    // Only allow check-in within the 30-minute pre-shift window (or later).
    const now = new Date();
    const { end: shiftEnd } = getEffectiveTimes(shift);
    const minutesToStart = minutesUntilStart(shift, now);
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
      optimisticUpdateUpcoming(bookingId, { checked_in_at: new Date().toISOString() });
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

  const hours = profile?.total_hours ?? 0;
  const privilegesSuspended = profile?.booking_privileges === false;
  const bgFailed = profile?.bg_check_status === "failed" || profile?.bg_check_status === "expired";

  // Filter upcoming bookings based on eligibility
  const eligibleBookings = upcomingBookings.filter((b) => {
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

      <DashboardAlerts profile={profile as unknown as AlertProfile} />

      <PendingConfirmationsBanner pendingConfirmations={pendingConfirmations} />

      {waitlistOffers.map((offer) => (
        <WaitlistOfferCard
          key={offer.id}
          offer={offer}
          onAccept={handleWaitlistAccept}
          onDecline={handleWaitlistDecline}
        />
      ))}

      <PassiveWaitlistList items={waitlistPassive} onLeave={handleLeaveWaitlist} />

      <InvitationsList
        invitations={invitations}
        actioningId={invitationActioning}
        onAccept={handleInvitationAccept}
        onDecline={handleInvitationDecline}
      />

      <DashboardStats
        upcomingCount={eligibleBookings.length}
        hours={hours}
        consistencyScore={profile?.consistency_score ?? null}
        points={profile?.volunteer_points || 0}
      />

      <UpcomingShiftsSection
        loading={loading}
        privilegesSuspended={privilegesSuspended}
        eligibleBookings={eligibleBookings}
        today={today}
        userId={user?.id}
        onCheckIn={handleCheckIn}
        onCancel={handleCancel}
      />

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost">My Impact Over Time <ChevronDown className="ml-1 h-4 w-4" /></Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <VolunteerImpactCharts />
        </CollapsibleContent>
      </Collapsible>

      <InvitationConflictDialog
        conflict={inviteConflict}
        onOpenChange={(open) => { if (!open) setInviteConflict(null); }}
        onAcceptWithCancel={(c) => completeInvitationAccept(c.invitation, c.conflictBookingId, c.conflictShift)}
        onDeclineForConflict={(c) => handleInvitationDecline(c.invitation, "scheduling conflict")}
      />
    </div>
  );
}
