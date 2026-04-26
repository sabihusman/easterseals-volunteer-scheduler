import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import type { AdminUserRole } from "@/hooks/useAdminUsers";

export interface RoleChangeTarget {
  id: string;
  name: string;
  from: AdminUserRole;
  to: AdminUserRole;
}

interface Props {
  target: RoleChangeTarget | null;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function describe(to: AdminUserRole): string {
  if (to === "coordinator") return "This volunteer will gain access to the coordinator dashboard for their assigned department.";
  if (to === "admin") return "Admins have full access to all data. There can only be 2 admins at any time.";
  return "";
}

/**
 * Role change confirmation. Page owns the actual update (audit-affecting +
 * post-success chain to dept assignment) — this is just the AlertDialog UI.
 */
export function RoleChangeDialog({ target, loading, onConfirm, onClose }: Props) {
  return (
    <AlertDialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change Role</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to change {target?.name}'s role to {target?.to}?
          </AlertDialogDescription>
          {target && (target.to === "coordinator" || target.to === "admin") && (
            <div className="flex items-start gap-2 mt-2 p-3 rounded-md bg-warning/10 border border-warning/30">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <p className="text-sm text-foreground">{describe(target.to)}</p>
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={loading}>
            {loading ? "Updating..." : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
