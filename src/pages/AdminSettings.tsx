import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Shield, FileText } from "lucide-react";
import { format } from "date-fns";
import { NOTES_ENABLED } from "@/config/featureFlags";

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [coordinators, setCoordinators] = useState<any[]>([]);
  const [selectedCoordinator, setSelectedCoordinator] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const [{ data: coords }, { data: noteData }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").eq("role", "coordinator"),
        supabase.from("shift_notes").select("*, profiles:author_id(full_name), shift_bookings(shifts(title, shift_date, departments(name)))").order("created_at", { ascending: false }).limit(50),
      ]);
      setCoordinators(coords || []);
      setNotes(noteData || []);
      setLoadingNotes(false);
    };
    fetch();
  }, []);

  const handleTransfer = async () => {
    if (!user || !selectedCoordinator) return;
    setTransferring(true);
    const { error } = await supabase.rpc("transfer_admin_role", {
      from_admin_id: user.id,
      to_coordinator_id: selectedCoordinator,
    });
    setTransferring(false);
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Admin role transferred", description: "You are now a coordinator. Please reload." });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Admin Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Transfer Admin Role</CardTitle>
          <CardDescription>Transfer your admin role to an existing coordinator. Max 2 admins enforced.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Select Coordinator</Label>
            <Select value={selectedCoordinator} onValueChange={setSelectedCoordinator}>
              <SelectTrigger><SelectValue placeholder="Choose a coordinator" /></SelectTrigger>
              <SelectContent>
                {coordinators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.full_name} ({c.email})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={!selectedCoordinator}>Transfer Admin Role</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>This will transfer your admin role to the selected coordinator. You will become a coordinator. This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleTransfer} disabled={transferring}>
                  {transferring ? "Transferring..." : "Confirm Transfer"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Pilot dark-launch — see src/config/featureFlags.ts.
          The notes audit panel is part of the Notes feature surface;
          hiding it keeps the admin UI consistent with the volunteer-
          side hide. The shift_notes table itself is untouched, so
          existing rows remain in the DB for re-enable. */}
      {NOTES_ENABLED && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />All Shift Notes</CardTitle>
            <CardDescription>Notes from all departments</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingNotes ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : notes.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No notes found.</p>
            ) : (
              <div className="space-y-3">
                {notes.map((n) => (
                  <div key={n.id} className="p-3 rounded-md bg-muted/50 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{n.profiles?.full_name}</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(n.created_at), "MMM d, yyyy")}</span>
                    </div>
                    <p className="text-sm">{n.content}</p>
                    <div className="text-xs text-muted-foreground">
                      {n.shift_bookings?.shifts?.title} • {n.shift_bookings?.shifts?.departments?.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
