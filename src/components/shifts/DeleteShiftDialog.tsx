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

export interface DeleteShiftTarget {
  id: string;
  bookingCount: number;
}

interface Props {
  /** When non-null, dialog is open. Set to null via onClose to close. */
  target: DeleteShiftTarget | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Two-step delete confirmation. Caller is responsible for fetching the
 * confirmed-booking count before opening (`requestDelete` in the page),
 * so the warning copy reflects the actual blast radius of the delete.
 */
export function DeleteShiftDialog({ target, onConfirm, onClose }: Props) {
  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
          <AlertDialogDescription>
            {target && target.bookingCount > 0
              ? `This will permanently remove the shift and CANCEL ${target.bookingCount} confirmed booking${target.bookingCount !== 1 ? "s" : ""}. This cannot be undone.`
              : "This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
