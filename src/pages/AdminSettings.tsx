import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Shield } from "lucide-react";

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [coordinatorId, setCoordinatorId] = useState("");
  const [transferring, setTransferring] = useState(false);

  const handleTransfer = async () => {
    if (!user || !coordinatorId.trim()) return;
    setTransferring(true);
    const { error } = await supabase.rpc("transfer_admin_role", {
      from_admin_id: user.id,
      to_coordinator_id: coordinatorId.trim(),
    });
    setTransferring(false);
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Admin role transferred", description: "You are now a coordinator. Please reload." });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Admin Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Transfer Admin Role</CardTitle>
          <CardDescription>Transfer your admin role to an existing coordinator. This action cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Coordinator User ID</Label>
            <Input value={coordinatorId} onChange={(e) => setCoordinatorId(e.target.value)} placeholder="Enter coordinator UUID" />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={!coordinatorId.trim()}>Transfer Admin Role</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>This will transfer your admin role to the specified coordinator. You will become a coordinator. This cannot be undone.</AlertDialogDescription>
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
    </div>
  );
}
