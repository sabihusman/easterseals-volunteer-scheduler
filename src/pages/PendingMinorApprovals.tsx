import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Check, X, AlertTriangle, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { sendEmail } from "@/lib/email-utils";

/**
 * Admin-only queue of bookings in 'pending_admin_approval' status —
 * the new state introduced in Half B-1 for minor volunteers' bookings.
 *
 * Each row is its own line item even when multiple minors book the
 * same shift (per the brief). Sorted by shift start time ascending
 * so the most-urgent approvals are at the top.
 *
 * Approve flow:
 *   - UPDATE booking_status → 'confirmed' (existing sync_booked_slots
 *     trigger handles booked_slots increment, including over-capacity
 *     by 1 when the shift is now full).
 *   - Capacity tie-break: if the shift's confirmed booking count >=
 *     total_slots at approval time, the modal warns "shift now full"
 *     and the admin chooses approve-anyway (over-capacity by 1) or
 *     deny-with-shift-full reason. Default action stays Approve.
 *   - Fires confirmation in-app notification + email (existing
 *     sendEmail helper, MailerSend).
 *
 * Deny flow:
 *   - Modal requires a reason.
 *   - UPDATE booking_status → 'rejected'. The volunteer-side bookings
 *     query filters rejected out, so the booking disappears from
 *     their view; the denial notification carries the reason.
 *   - Fires rejection in-app notification + email.
 *
 * Notifications are NOT gated on MESSAGING_ENABLED — these are
 * notifications-table notifications, not messages (per Half A
 * groundwork & the brief).
 */
interface PendingBooking {
  id: string;
  volunteer_id: string;
  shift_id: string;
  created_at: string;
  profiles: { full_name: string | null; email: string | null } | null;
  shifts: {
    id: string;
    title: string;
    shift_date: string;
    start_time: string | null;
    end_time: string | null;
    total_slots: number;
    booked_slots: number;
    department_id: string;
    departments: { name: string } | null;
  } | null;
}

type ActionState =
  | { kind: "idle" }
  | { kind: "approving"; booking: PendingBooking; overCapacity: boolean }
  | { kind: "denying"; booking: PendingBooking; reason: string };

export default function PendingMinorApprovals() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [bookings, setBookings] = useState<PendingBooking[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState<ActionState>({ kind: "idle" });

  const fetchPending = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("shift_bookings")
      .select(`
        id, volunteer_id, shift_id, created_at,
        profiles:volunteer_id ( full_name, email ),
        shifts ( id, title, shift_date, start_time, end_time, total_slots, booked_slots, department_id, departments ( name ) )
      `)
      .eq("booking_status", "pending_admin_approval")
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Failed to load queue", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    // Sort by shift start time ascending — most-urgent first. Done
    // client-side because the order-by-shift-date join in PostgREST
    // is awkward; queue size is small (at most a few dozen).
    const sorted = ((data ?? []) as PendingBooking[]).slice().sort((a, b) => {
      const ad = a.shifts?.shift_date ?? "9999-12-31";
      const bd = b.shifts?.shift_date ?? "9999-12-31";
      if (ad !== bd) return ad.localeCompare(bd);
      const at = a.shifts?.start_time ?? "23:59";
      const bt = b.shifts?.start_time ?? "23:59";
      return at.localeCompare(bt);
    });
    setBookings(sorted);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchPending();
    supabase.from("departments").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => { if (data) setDepartments(data as any); });
  }, [fetchPending]);

  const filtered = departmentFilter === "all"
    ? bookings
    : bookings.filter((b) => b.shifts?.department_id === departmentFilter);

  const formatShiftTime = (b: PendingBooking) => {
    const s = b.shifts;
    if (!s) return "—";
    const date = format(new Date(s.shift_date + "T00:00:00"), "EEE, MMM d, yyyy");
    if (s.start_time && s.end_time) return `${date} · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
    return date;
  };

  const startApprove = (b: PendingBooking) => {
    const s = b.shifts;
    const overCapacity = !!(s && s.booked_slots >= s.total_slots);
    setAction({ kind: "approving", booking: b, overCapacity });
  };

  const startDeny = (b: PendingBooking) => {
    setAction({ kind: "denying", booking: b, reason: "" });
  };

  const handleApprove = async (denyShiftFullInstead: boolean) => {
    if (action.kind !== "approving" || !user) return;
    if (denyShiftFullInstead) {
      // Capacity tie-break: admin opted to deny with shift-full reason.
      await doDeny(action.booking, "Shift filled while your booking was pending. Please book another shift.");
      setAction({ kind: "idle" });
      return;
    }
    setSubmitting(true);
    const b = action.booking;
    const { error } = await (supabase as any)
      .from("shift_bookings")
      .update({
        booking_status: "confirmed",
        confirmed_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", b.id)
      .eq("booking_status", "pending_admin_approval"); // idempotency guard

    if (error) {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Notification (in-app + email). Not gated on MESSAGING_ENABLED.
    const shiftTitle = b.shifts?.title ?? "your shift";
    const deptName = b.shifts?.departments?.name ?? "the department";
    const when = formatShiftTime(b);
    await supabase.from("notifications").insert({
      user_id: b.volunteer_id,
      type: "minor_booking_approved",
      title: "Booking approved",
      message: `Your booking for "${shiftTitle}" (${when}) has been approved.`,
      link: "/dashboard",
      is_read: false,
    });
    if (b.profiles?.email) {
      await sendEmail({
        to: b.profiles.email,
        type: "minor_booking_approved",
        subject: `Booking approved — ${shiftTitle}`,
        text:
          `Hi ${b.profiles.full_name ?? "there"},\n\n` +
          `Your booking for "${shiftTitle}" with ${deptName} on ${when} has been approved by an administrator. ` +
          `You're confirmed for the shift.\n\n` +
          `— Easterseals Iowa volunteer scheduler`,
      } as any).catch(console.error);
    }

    toast({ title: "Booking approved", description: `${b.profiles?.full_name ?? "Volunteer"} confirmed for "${shiftTitle}".` });
    setAction({ kind: "idle" });
    setSubmitting(false);
    setBookings((prev) => prev.filter((x) => x.id !== b.id));
  };

  const doDeny = async (b: PendingBooking, reason: string) => {
    if (!user) return;
    setSubmitting(true);
    const { error } = await (supabase as any)
      .from("shift_bookings")
      .update({
        booking_status: "rejected",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", b.id)
      .eq("booking_status", "pending_admin_approval");

    if (error) {
      toast({ title: "Denial failed", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const shiftTitle = b.shifts?.title ?? "your shift";
    const deptName = b.shifts?.departments?.name ?? "the department";
    const when = formatShiftTime(b);
    await supabase.from("notifications").insert({
      user_id: b.volunteer_id,
      type: "minor_booking_rejected",
      title: "Booking not approved",
      message: `Your booking for "${shiftTitle}" (${when}) was not approved. Reason: ${reason}`,
      link: "/shifts",
      is_read: false,
    });
    if (b.profiles?.email) {
      await sendEmail({
        to: b.profiles.email,
        type: "minor_booking_rejected",
        subject: `Booking not approved — ${shiftTitle}`,
        text:
          `Hi ${b.profiles.full_name ?? "there"},\n\n` +
          `Your booking for "${shiftTitle}" with ${deptName} on ${when} was not approved.\n\n` +
          `Reason: ${reason}\n\n` +
          `You can browse other shifts in the volunteer scheduler.\n\n` +
          `— Easterseals Iowa volunteer scheduler`,
      } as any).catch(console.error);
    }

    toast({ title: "Booking denied", description: `${b.profiles?.full_name ?? "Volunteer"} notified.` });
    setBookings((prev) => prev.filter((x) => x.id !== b.id));
    setSubmitting(false);
  };

  const handleDeny = async () => {
    if (action.kind !== "denying") return;
    const reason = action.reason.trim();
    if (!reason) {
      toast({ title: "Reason required", description: "Please enter a reason for denial.", variant: "destructive" });
      return;
    }
    await doDeny(action.booking, reason);
    setAction({ kind: "idle" });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Pending Minor Approvals
          </h2>
          <p className="text-sm text-muted-foreground">
            Bookings from volunteers under 18 awaiting administrator approval. Approving confirms the booking;
            denying rejects it with a reason the volunteer is notified about.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Department</Label>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading queue...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {departmentFilter === "all"
              ? "No pending minor approvals."
              : "No pending approvals in the selected department."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((b) => {
            const overCap = !!(b.shifts && b.shifts.booked_slots >= b.shifts.total_slots);
            return (
              <Card key={b.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{b.shifts?.title ?? "(Shift unavailable)"}</CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {b.shifts?.departments?.name ?? "—"} · {formatShiftTime(b)}
                      </CardDescription>
                    </div>
                    {overCap && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />Shift now full
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pb-4 space-y-3">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Volunteer:</span>{" "}
                    <span className="font-medium">{b.profiles?.full_name ?? b.profiles?.email ?? b.volunteer_id}</span>
                    {b.profiles?.email && b.profiles.full_name && (
                      <span className="text-muted-foreground"> · {b.profiles.email}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => startApprove(b)} disabled={submitting}>
                      <Check className="h-4 w-4 mr-1" />Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => startDeny(b)} disabled={submitting}>
                      <X className="h-4 w-4 mr-1" />Deny
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Approve confirmation (with capacity tie-break) */}
      <AlertDialog open={action.kind === "approving"} onOpenChange={(open) => !open && setAction({ kind: "idle" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this booking?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  This confirms{" "}
                  <span className="font-medium">{action.kind === "approving" ? action.booking.profiles?.full_name ?? "the volunteer" : ""}</span>{" "}
                  for{" "}
                  <span className="font-medium">{action.kind === "approving" ? action.booking.shifts?.title : ""}</span>.
                  An in-app notification and email will be sent.
                </div>
                {action.kind === "approving" && action.overCapacity && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <strong>Shift now full.</strong> Approving will put this shift one slot over capacity.
                    You can also deny this booking with a shift-full reason instead.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap gap-2">
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            {action.kind === "approving" && action.overCapacity && (
              <Button
                variant="outline"
                onClick={() => handleApprove(true)}
                disabled={submitting}
              >
                Deny with shift-full reason
              </Button>
            )}
            <AlertDialogAction onClick={() => handleApprove(false)} disabled={submitting}>
              {submitting ? "Approving…" : action.kind === "approving" && action.overCapacity ? "Approve anyway" : "Approve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deny dialog (reason required) */}
      <AlertDialog open={action.kind === "denying"} onOpenChange={(open) => !open && setAction({ kind: "idle" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deny this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              The volunteer will be notified by email and in-app with the reason you enter below.
              The booking will move to the rejected state and disappear from their bookings list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="deny-reason">Reason (required)</Label>
            <Textarea
              id="deny-reason"
              rows={4}
              value={action.kind === "denying" ? action.reason : ""}
              onChange={(e) => setAction(
                action.kind === "denying"
                  ? { ...action, reason: e.target.value }
                  : action,
              )}
              placeholder="e.g. The shift requires skills outside our minor volunteer program."
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeny} disabled={submitting}>
              {submitting ? "Denying…" : "Deny booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
