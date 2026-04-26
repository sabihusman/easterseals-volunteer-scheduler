import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import type { AdminUserRole } from "@/hooks/useAdminUsers";

export interface DeleteUserTarget {
  id: string;
  name: string;
  role: AdminUserRole;
}

interface Props {
  target: DeleteUserTarget | null;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Force-delete confirmation. Page owns the actual delete (audit-affecting
 * via the `delete-user` edge function + optimistic state remove) — this is
 * just the AlertDialog UI with role-aware copy.
 */
export function DeleteUserDialog({ target, loading, onConfirm, onClose }: Props) {
  return (
    <AlertDialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Account — This Cannot Be Undone</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to permanently delete {target?.name}'s account. This action cannot be reversed. If this user wishes to use the portal again they will need to register a new account.
          </AlertDialogDescription>
          {target && (
            <div className="flex items-start gap-2 mt-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-foreground">
                {target.role === "volunteer"
                  ? "All of their active shift bookings will be automatically cancelled."
                  : "Their created shifts will remain unchanged."}
              </p>
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={loading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {loading ? "Deleting..." : "Delete Permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
