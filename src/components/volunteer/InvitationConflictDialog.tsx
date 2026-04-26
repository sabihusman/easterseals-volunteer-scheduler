import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import type { ShiftInvitation } from "@/hooks/useShiftInvitations";

export interface InvitationConflict {
  invitation: ShiftInvitation;
  conflictBookingId: string;
  conflictShift: {
    id: string;
    title: string;
    shift_date: string;
    start_time: string | null;
    end_time: string | null;
    department_id: string;
    departments: { name: string } | null;
  };
}

interface Props {
  conflict: InvitationConflict | null;
  onOpenChange: (open: boolean) => void;
  /** "Cancel my existing booking and accept the invited one." */
  onAcceptWithCancel: (conflict: InvitationConflict) => void;
  /** "Keep my existing booking and decline the invitation." */
  onDeclineForConflict: (conflict: InvitationConflict) => void;
}

/**
 * Modal that surfaces when accepting an invitation conflicts with an
 * existing confirmed booking. Caller drives both branches.
 */
export function InvitationConflictDialog({ conflict, onOpenChange, onAcceptWithCancel, onDeclineForConflict }: Props) {
  return (
    <AlertDialog open={!!conflict} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" /> Scheduling Conflict
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Accepting this shift will conflict with your existing booking:</p>
              {conflict?.conflictShift && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  <strong>{conflict.conflictShift.title}</strong> on{" "}
                  {conflict.conflictShift.shift_date} from{" "}
                  {conflict.conflictShift.start_time?.slice(0, 5)} to{" "}
                  {conflict.conflictShift.end_time?.slice(0, 5)}
                </div>
              )}
              <p>Would you like to cancel your existing booking and accept this invitation?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel
            onClick={() => {
              if (conflict) onDeclineForConflict(conflict);
            }}
          >
            Keep My Existing Booking &amp; Decline
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (conflict) onAcceptWithCancel(conflict);
            }}
          >
            Cancel Existing &amp; Accept Invitation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
