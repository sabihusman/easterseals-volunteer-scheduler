import { useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { useShiftsList, type Shift } from "@/hooks/useShiftsList";
import { ShiftsTable } from "@/components/shifts/ShiftsTable";
import { ShiftFormDialog } from "@/components/shifts/ShiftFormDialog";
import { DeleteShiftDialog, type DeleteShiftTarget } from "@/components/shifts/DeleteShiftDialog";
import { InviteVolunteerModal } from "@/components/shifts/InviteVolunteerModal";
import { parseShiftDate, timeLabel } from "@/lib/calendar-utils";
import { cancelShiftWithNotifications } from "@/lib/shift-cancel";

/**
 * ManageShifts orchestrator. The page coordinates dialog open/close state
 * because the shifts table is what triggers edit/delete/invite — but the
 * dialogs themselves own their internal form/loading state.
 *
 * "Delete" is a soft-delete (UPDATE status='cancelled'). The DB policy
 * `shifts: coord delete cancelled` only permits coordinators to hard
 * DELETE shifts that are already cancelled — and the user-visible action
 * here is the cancel transition itself, not the eventual hard delete.
 * Audit 2026-04-28 found the previous .delete() call hit RLS, returned
 * 200 + empty body, and surfaced a "Shift deleted" toast on a no-op.
 */
export default function ManageShifts() {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const { shifts, departments, loading, refresh } = useShiftsList(user, role);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteShiftTarget | null>(null);
  const [deleteShiftRecord, setDeleteShiftRecord] = useState<Shift | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submittingCancel, setSubmittingCancel] = useState(false);
  const [inviteShift, setInviteShift] = useState<Shift | null>(null);

  function openCreate() {
    setEditingShift(null);
    setDialogOpen(true);
  }

  function openEdit(shift: Shift) {
    setEditingShift(shift);
    setDialogOpen(true);
  }

  /**
   * Stage the cancellation. We resolve the booked-volunteer count and
   * the 24h-urgency flag here so the dialog copy can describe the blast
   * radius before the coordinator commits.
   */
  async function requestDelete(shiftId: string) {
    const shift = shifts.find((s) => s.id === shiftId);
    if (!shift) return;

    const { count } = await supabase
      .from("shift_bookings")
      .select("*", { count: "exact", head: true })
      .eq("shift_id", shiftId)
      .eq("booking_status", "confirmed");

    const startMs = new Date(`${shift.shift_date}T${shift.start_time || "00:00:00"}`).getTime();
    const isUrgent = startMs - Date.now() < 24 * 60 * 60 * 1000 && startMs > Date.now();

    setDeleteShiftRecord(shift);
    setCancelReason("");
    setDeleteTarget({ id: shiftId, bookingCount: count ?? 0, isUrgent });
  }

  async function confirmDelete() {
    if (!deleteTarget || !deleteShiftRecord) return;
    setSubmittingCancel(true);

    const result = await cancelShiftWithNotifications({
      shift: deleteShiftRecord,
      reason: cancelReason.trim() || null,
      isUrgent: deleteTarget.isUrgent,
      shiftDateFormatted: format(parseShiftDate(deleteShiftRecord.shift_date), "MMM d, yyyy"),
      shiftTimeLabel: timeLabel(deleteShiftRecord),
    });

    setSubmittingCancel(false);

    if (!result.ok) {
      // The cancel helper distinguishes RLS-zero-rows ("not allowed") from
      // hard errors. Both surface as a destructive toast — the previous
      // bug was a "Shift deleted" success toast on the zero-rows path.
      toast({
        variant: "destructive",
        title: result.kind === "not_allowed" ? "Cannot cancel shift" : "Error",
        description: result.message,
      });
      return;
    }

    setDeleteTarget(null);
    setDeleteShiftRecord(null);
    setCancelReason("");

    const notified = result.notifiedCount;
    toast({
      title: "Shift cancelled",
      description:
        notified > 0
          ? `${notified} volunteer${notified !== 1 ? "s have" : " has"} been notified.`
          : "No volunteers were booked.",
    });
    refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Manage Shifts</h1>
        <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" /> New Shift
        </Button>
      </div>

      <ShiftsTable
        shifts={shifts}
        onEdit={openEdit}
        onDelete={requestDelete}
        onInvite={setInviteShift}
      />

      {user && (
        <ShiftFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingShift={editingShift}
          departments={departments}
          userId={user.id}
          role={role}
          onSaved={refresh}
        />
      )}

      <DeleteShiftDialog
        target={deleteTarget}
        reason={cancelReason}
        onReasonChange={setCancelReason}
        onConfirm={confirmDelete}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteShiftRecord(null);
          setCancelReason("");
        }}
        submitting={submittingCancel}
      />

      {inviteShift && (
        <InviteVolunteerModal
          shift={inviteShift}
          open={!!inviteShift}
          onOpenChange={(open) => { if (!open) setInviteShift(null); }}
        />
      )}
    </div>
  );
}
