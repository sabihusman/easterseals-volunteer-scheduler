import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface DeleteShiftTarget {
  id: string;
  bookingCount: number;
  /**
   * True when the shift starts within 24 hours of "now" (computed by the
   * caller in `requestDelete`). Drives the SMS-eligibility flag attached
   * to the cancellation notification: only urgent (<24h) cancellations
   * page volunteers via SMS, since a 5-day-out cancel doesn't justify a
   * text message.
   */
  isUrgent: boolean;
}

interface Props {
  /** When non-null, dialog is open. Set to null via onClose to close. */
  target: DeleteShiftTarget | null;
  /**
   * Reason text from the textarea. Lifted to the parent so the parent
   * holds the cancellation context across the confirmation click.
   */
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  /** Disable the confirm button while the cancellation is in flight. */
  submitting?: boolean;
}

/**
 * Cancellation confirmation dialog for the coordinator's "Delete shift"
 * action. We renamed the user-facing copy from "Delete" to "Cancel"
 * because the action is a soft-delete (UPDATE status='cancelled'), not
 * a hard DELETE — coordinators don't have a DELETE policy on open
 * shifts, only on already-cancelled ones (PR audit, 2026-04-28).
 *
 * Caller is responsible for fetching the confirmed-booking count and
 * computing the 24h-urgent flag before opening (`requestDelete` in the
 * page), so the warning copy reflects the actual blast radius.
 */
export function DeleteShiftDialog({
  target,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
  submitting = false,
}: Props) {
  const bookingCount = target?.bookingCount ?? 0;
  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && !submitting && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this shift?</AlertDialogTitle>
          <AlertDialogDescription>
            {bookingCount > 0
              ? `This will cancel the shift and notify ${bookingCount} booked volunteer${bookingCount !== 1 ? "s" : ""} by email${target?.isUrgent ? " and SMS (shift starts within 24 hours)" : ""}. The shift will be removed from the schedule.`
              : "This will cancel the shift and remove it from the schedule. No volunteers are currently booked."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="cancel-shift-reason">
            Reason <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="cancel-shift-reason"
            placeholder="Brief explanation for the volunteers (e.g., weather, scheduling change). Leave blank to send a generic cancellation notice."
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={3}
            maxLength={500}
            disabled={submitting}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Keep shift</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={submitting}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {submitting ? "Cancelling…" : "Cancel shift"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
