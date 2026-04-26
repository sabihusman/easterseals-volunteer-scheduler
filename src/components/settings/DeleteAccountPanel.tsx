import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  userId: string;
  email: string;
  role: string | null;
  onSignOut: () => Promise<void>;
}

/**
 * Account deletion danger zone. Renders nothing for admins (caller decides
 * whether to mount this panel; behavior preservation: the original page
 * gated the entire card on `role !== "admin"`).
 *
 * Confirms with email-typing match. On success, calls `delete-user` edge
 * function, signs out, and navigates to /auth with `accountDeleted: true`
 * passed through router state.
 */
export function DeleteAccountPanel({ userId, email, role, onSignOut }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    const { error } = await supabase.functions.invoke("delete-user", {
      body: { userId },
    });
    setDeleteLoading(false);
    if (error) {
      toast({ title: "Error", description: "Could not delete account. Please contact support.", variant: "destructive" });
      return;
    }
    await onSignOut();
    navigate("/auth", { state: { accountDeleted: true } });
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data. This action cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground">
              <Trash2 className="h-4 w-4 mr-2" /> Delete My Account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Your Account — This Cannot Be Undone</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>You are about to permanently delete your account.</p>
                {role === "volunteer" && (
                  <p>All your active shift bookings will be automatically cancelled.</p>
                )}
                {role === "coordinator" && (
                  <p>Your created shifts will remain but will no longer have a coordinator assigned.</p>
                )}
                <p>You will need to register a new account if you wish to return.</p>
                <div className="pt-2">
                  <Label>Type your email to confirm:</Label>
                  <Input
                    className="mt-1"
                    value={deleteConfirmEmail}
                    onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                    placeholder={email}
                  />
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteConfirmEmail !== email || deleteLoading}
                onClick={handleDeleteAccount}
              >
                {deleteLoading ? "Deleting..." : "Delete My Account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
