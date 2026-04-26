import { useState } from "react";
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

/**
 * ManageShifts orchestrator. The page coordinates dialog open/close state
 * because the shifts table is what triggers edit/delete/invite — but the
 * dialogs themselves own their internal form/loading state.
 */
export default function ManageShifts() {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const { shifts, departments, loading, refresh } = useShiftsList(user, role);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteShiftTarget | null>(null);
  const [inviteShift, setInviteShift] = useState<Shift | null>(null);

  function openCreate() {
    setEditingShift(null);
    setDialogOpen(true);
  }

  function openEdit(shift: Shift) {
    setEditingShift(shift);
    setDialogOpen(true);
  }

  async function requestDelete(shiftId: string) {
    const { count } = await supabase
      .from("shift_bookings")
      .select("*", { count: "exact", head: true })
      .eq("shift_id", shiftId)
      .eq("booking_status", "confirmed");
    setDeleteTarget({ id: shiftId, bookingCount: count ?? 0 });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from("shifts").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Shift deleted" });
      refresh();
    }
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
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
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
