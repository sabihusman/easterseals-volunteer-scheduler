import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, CheckCircle, XCircle, Clock, Calendar, Users,
  Gavel, Timer,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { timeLabel } from "@/lib/calendar-utils";
import { formatSlotRange } from "@/lib/slot-utils";

interface Dispute {
  id: string;
  booking_id: string;
  shift_id: string;
  volunteer_id: string;
  coordinator_id: string;
  volunteer_status: string;
  volunteer_reported_hours: number | null;
  coordinator_status: string;
  admin_decision: string | null;
  admin_decided_by: string | null;
  admin_decided_at: string | null;
  admin_notes: string | null;
  resolved_by: string | null;
  final_hours_awarded: number | null;
  created_at: string;
  expires_at: string;
  // Joined data
  volunteer: { full_name: string; email: string } | null;
  coordinator: { full_name: string } | null;
  admin_decider: { full_name: string } | null;
  shifts: {
    title: string;
    shift_date: string;
    start_time: string | null;
    end_time: string | null;
    time_type: string;
    departments: { name: string } | null;
  } | null;
  shift_bookings: {
    time_slot_id: string | null;
    shift_time_slots: { slot_start: string; slot_end: string } | null;
  } | null;
}

export default function AdminDisputes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolveTarget, setResolveTarget] = useState<Dispute | null>(null);
  const [decision, setDecision] = useState<"volunteer_upheld" | "coordinator_upheld" | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchDisputes = useCallback(async () => {
    const { data, error } = await supabase
      .from("attendance_disputes")
      .select(`
        *,
        volunteer:profiles!attendance_disputes_volunteer_id_fkey(full_name, email),
        coordinator:profiles!attendance_disputes_coordinator_id_fkey(full_name),
        admin_decider:profiles!attendance_disputes_admin_decided_by_fkey(full_name),
        shifts(title, shift_date, start_time, end_time, time_type, departments(name)),
        shift_bookings(time_slot_id, shift_time_slots(slot_start, slot_end))
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("fetchDisputes error:", error);
    }
    setDisputes((data || []) as Dispute[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const pendingDisputes = disputes.filter((d) => !d.admin_decision);
  const resolvedDisputes = disputes.filter((d) => !!d.admin_decision);

  const handleResolve = async () => {
    if (!resolveTarget || !decision || !user) return;
    if (notes.trim().length < 10) {
      toast({ title: "Notes required", description: "Please enter at least 10 characters explaining your decision.", variant: "destructive" });
      return;
    }

    setSaving(true);

    // 1. Update the dispute
    const { error: disputeErr } = await supabase
      .from("attendance_disputes")
      .update({
        admin_decision: decision,
        admin_decided_by: user.id,
        admin_decided_at: new Date().toISOString(),
        admin_notes: notes.trim(),
        resolved_by: "admin",
        final_hours_awarded: decision === "volunteer_upheld"
          ? resolveTarget.volunteer_reported_hours || 0
          : 0,
      })
      .eq("id", resolveTarget.id);

    if (disputeErr) {
      toast({ title: "Error", description: disputeErr.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // 2. Update the booking
    const bookingUpdate = decision === "volunteer_upheld"
      ? {
          confirmation_status: "confirmed",
          final_hours: resolveTarget.volunteer_reported_hours || 0,
          hours_source: "dispute_admin_resolved",
        }
      : {
          confirmation_status: "no_show",
          final_hours: 0,
          hours_source: "dispute_admin_resolved",
        };

    await supabase
      .from("shift_bookings")
      .update(bookingUpdate)
      .eq("id", resolveTarget.booking_id);

    // 3. Notify volunteer
    const shiftTitle = resolveTarget.shifts?.title || "shift";
    const shiftDate = resolveTarget.shifts?.shift_date
      ? format(new Date(resolveTarget.shifts.shift_date + "T00:00:00"), "MMM d")
      : "";

    const volMessage = decision === "volunteer_upheld"
      ? `Your attendance for "${shiftTitle}" on ${shiftDate} has been confirmed. Hours awarded: ${resolveTarget.volunteer_reported_hours || 0}h.`
      : `Your attendance for "${shiftTitle}" on ${shiftDate} could not be confirmed. If you believe this is an error, please contact your coordinator.`;

    await supabase.from("notifications").insert([
      {
        user_id: resolveTarget.volunteer_id,
        type: "dispute_resolved",
        title: decision === "volunteer_upheld" ? "Attendance confirmed" : "Attendance not confirmed",
        message: volMessage,
        link: "/history",
        is_read: false,
      },
      {
        user_id: resolveTarget.coordinator_id,
        type: "dispute_resolved",
        title: "Dispute resolved by admin",
        message: `The attendance dispute for ${resolveTarget.volunteer?.full_name || "a volunteer"} on "${shiftTitle}" has been resolved: ${decision === "volunteer_upheld" ? "volunteer upheld" : "coordinator upheld"}.`,
        link: "/coordinator",
        is_read: false,
      },
    ]);

    setSaving(false);
    setResolveTarget(null);
    setDecision(null);
    setNotes("");
    toast({ title: "Dispute resolved" });
    fetchDisputes();
  };

  const DisputeCard = ({ d, showActions }: { d: Dispute; showActions: boolean }) => {
    const s = d.shifts;
    const slotInfo = d.shift_bookings?.shift_time_slots;
    const isPending = !d.admin_decision;
    const expiresAt = new Date(d.expires_at);
    const isExpired = expiresAt < new Date();

    return (
      <Card className={isPending ? "border-amber-500/40" : ""}>
        <CardContent className="pt-4 pb-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium flex items-center gap-2">
                  {d.volunteer?.full_name || "Unknown Volunteer"}
                  {isPending && (
                    <Badge className="text-[10px] bg-amber-500/20 text-amber-700 border-amber-500/40">
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Pending
                    </Badge>
                  )}
                  {d.admin_decision === "volunteer_upheld" && (
                    <Badge className="text-[10px] bg-green-500/20 text-green-700 border-green-500/40">
                      <CheckCircle className="h-2.5 w-2.5 mr-0.5" />Volunteer Upheld
                    </Badge>
                  )}
                  {d.admin_decision === "coordinator_upheld" && (
                    <Badge className="text-[10px] bg-red-500/20 text-red-700 border-red-500/40">
                      <XCircle className="h-2.5 w-2.5 mr-0.5" />Coordinator Upheld
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {s?.shift_date ? format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy") : "—"}
                  </span>
                  <span className="font-medium">{s?.title || "—"}</span>
                  {s?.departments?.name && <Badge variant="secondary" className="text-[10px]">{s.departments.name}</Badge>}
                  {slotInfo && (
                    <span className="text-xs">{formatSlotRange(slotInfo.slot_start, slotInfo.slot_end)}</span>
                  )}
                </div>
              </div>
              {isPending && !isExpired && (
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-xs text-amber-600">
                    <Timer className="h-3 w-3" />
                    Auto-resolves {formatDistanceToNow(expiresAt, { addSuffix: true })}
                  </div>
                </div>
              )}
            </div>

            {/* Claims */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3">
                <div className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Volunteer's Claim</div>
                <div className="text-sm">Attended · {d.volunteer_reported_hours ?? "—"}h reported</div>
                <div className="text-xs text-muted-foreground">{d.volunteer?.email}</div>
              </div>
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                <div className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Coordinator's Claim</div>
                <div className="text-sm">Absent</div>
                <div className="text-xs text-muted-foreground">By {d.coordinator?.full_name || "—"}</div>
              </div>
            </div>

            {/* Resolution info */}
            {d.admin_decision && (
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <Gavel className="h-3 w-3" />
                  <span className="font-medium">
                    {d.resolved_by === "auto_timeout" ? "Auto-resolved after 7 days" : `Resolved by ${d.admin_decider?.full_name || "admin"}`}
                  </span>
                  {d.admin_decided_at && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(d.admin_decided_at), "MMM d, yyyy h:mm a")}
                    </span>
                  )}
                </div>
                {d.admin_notes && <p className="text-muted-foreground text-xs">{d.admin_notes}</p>}
                {d.final_hours_awarded != null && (
                  <div className="text-xs">Hours awarded: <strong>{d.final_hours_awarded}h</strong></div>
                )}
              </div>
            )}

            {/* Actions */}
            {showActions && isPending && (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    setResolveTarget(d);
                    setDecision("volunteer_upheld");
                    setNotes("");
                  }}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />Uphold Volunteer
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setResolveTarget(d);
                    setDecision("coordinator_upheld");
                    setNotes("");
                  }}
                >
                  <XCircle className="h-3 w-3 mr-1" />Uphold Coordinator
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Attendance Disputes</h2>
        <p className="text-muted-foreground">
          Review cases where coordinators and volunteers disagree on attendance
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading disputes...</p>
      ) : disputes.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No attendance disputes found.
          </CardContent>
        </Card>
      ) : (
        <>
          {pendingDisputes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Pending Review ({pendingDisputes.length})
              </h3>
              {pendingDisputes.map((d) => (
                <DisputeCard key={d.id} d={d} showActions={true} />
              ))}
            </div>
          )}

          {resolvedDisputes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Resolved ({resolvedDisputes.length})</h3>
              {resolvedDisputes.map((d) => (
                <DisputeCard key={d.id} d={d} showActions={false} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Resolve dialog */}
      <Dialog open={!!resolveTarget} onOpenChange={(open) => { if (!open) { setResolveTarget(null); setDecision(null); setNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "volunteer_upheld" ? "Uphold Volunteer's Claim" : "Uphold Coordinator's Claim"}
            </DialogTitle>
            <DialogDescription>
              {decision === "volunteer_upheld"
                ? `The volunteer's reported hours (${resolveTarget?.volunteer_reported_hours ?? 0}h) will be awarded and the booking marked as completed.`
                : "The volunteer will be marked as a no-show. No hours will be awarded."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Admin Notes (required, min 10 characters)</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Explain your decision..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">{notes.length} characters</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResolveTarget(null); setDecision(null); }}>Cancel</Button>
            <Button
              onClick={handleResolve}
              disabled={saving || notes.trim().length < 10}
              className={decision === "volunteer_upheld" ? "bg-green-600 hover:bg-green-700" : ""}
              variant={decision === "coordinator_upheld" ? "destructive" : "default"}
            >
              {saving ? "Saving..." : "Confirm Decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
