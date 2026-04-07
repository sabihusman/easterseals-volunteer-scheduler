import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle, CheckCircle2, Trash2, Clock, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface UnactionedShift {
  booking_id: string;
  shift_id: string;
  volunteer_id: string;
  volunteer_name: string;
  volunteer_email: string;
  shift_title: string;
  shift_date: string;
  department_name: string | null;
  checked_in: boolean;
  actioned_off: boolean;
  shift_end: string;
  hours_since_end: number;
}

export default function AdminUnactionedShifts() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<UnactionedShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UnactionedShift | null>(null);
  const [actionTarget, setActionTarget] = useState<UnactionedShift | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("get_unactioned_shifts");
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data || []) as UnactionedShift[]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleActionOff = async () => {
    if (!actionTarget) return;
    setActioningId(actionTarget.booking_id);
    const { error } = await (supabase as any)
      .rpc("admin_action_off_shift", { p_booking_id: actionTarget.booking_id });
    setActioningId(null);
    setActionTarget(null);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Shift actioned off", description: "The volunteer's hours have been recorded." });
    fetchRows();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActioningId(deleteTarget.booking_id);
    const { error } = await (supabase as any)
      .rpc("admin_delete_unactioned_shift", { p_booking_id: deleteTarget.booking_id });
    setActioningId(null);
    setDeleteTarget(null);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Shift deleted", description: "Removed from volunteer history." });
    fetchRows();
  };

  const formatAge = (hours: number) => {
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    const days = hours / 24;
    if (days < 7) return `${days.toFixed(1)}d ago`;
    return `${Math.floor(days)}d ago`;
  };

  const ageBadge = (hours: number) => {
    if (hours >= 120) return <Badge variant="destructive">{formatAge(hours)}</Badge>;
    if (hours >= 48) return <Badge className="bg-amber-500 text-white hover:bg-amber-600">{formatAge(hours)}</Badge>;
    return <Badge variant="secondary">{formatAge(hours)}</Badge>;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-destructive" />
            Unactioned Shifts
          </h1>
          <p className="text-sm text-muted-foreground">
            Past shifts without a volunteer check-in or confirmation. Longest outstanding shown first.
            Shifts older than 7 days are auto-deleted.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRows} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Loading...</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
            <p className="font-medium">Nothing to review</p>
            <p className="text-sm text-muted-foreground">Every past shift has been checked in and confirmed.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.booking_id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">{r.shift_title}</CardTitle>
                    <CardDescription>
                      {format(new Date(r.shift_date + "T00:00:00"), "MMMM d, yyyy")}
                      {r.department_name ? ` · ${r.department_name}` : ""}
                    </CardDescription>
                  </div>
                  {ageBadge(Number(r.hours_since_end))}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm space-y-1">
                  <p>
                    <span className="text-muted-foreground">Volunteer:</span>{" "}
                    <span className="font-medium">{r.volunteer_name || r.volunteer_email}</span>
                  </p>
                  <div className="flex gap-2 text-xs">
                    {r.checked_in
                      ? <Badge variant="secondary" className="text-xs">Checked in</Badge>
                      : <Badge variant="outline" className="text-xs">No check-in</Badge>}
                    {r.actioned_off
                      ? <Badge variant="secondary" className="text-xs">Volunteer confirmed</Badge>
                      : <Badge variant="outline" className="text-xs">Not confirmed</Badge>}
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Ended {format(new Date(r.shift_end), "MMM d, h:mm a")}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => setActionTarget(r)}
                    disabled={actioningId === r.booking_id}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Action Off (Confirm)
                  </Button>
                  {role === "admin" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteTarget(r)}
                      disabled={actioningId === r.booking_id}
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Delete Shift
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Action-off confirmation */}
      <AlertDialog open={!!actionTarget} onOpenChange={(open) => !open && setActionTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark shift as complete?</AlertDialogTitle>
            <AlertDialogDescription>
              This will record the volunteer's hours based on the shift duration and confirm their attendance.
              Action-off is sufficient even without a check-in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleActionOff}>Confirm Shift</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift from history?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the booking from {deleteTarget?.volunteer_name || "the volunteer"}'s
              history. Their consistency score will be recalculated. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete Shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
