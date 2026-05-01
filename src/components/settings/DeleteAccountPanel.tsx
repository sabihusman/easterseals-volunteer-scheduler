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
 * Account self-deletion ("Danger Zone") panel.
 *
 * Calls the dedicated `delete-self` edge function rather than the
 * admin-only `delete-user` endpoint. Issue #178 root-caused the
 * cross-flow bug: `delete-user` requires the caller to be an admin,
 * which broke self-delete for everyone. The two endpoints are now
 * separate and have opposite role gates by design.
 *
 * Confirmation pattern: user must type their account email to enable
 * the destructive button. Comparison is case-insensitive but
 * trim-sensitive (per the brief — leading/trailing whitespace counts
 * as a typo, since real users don't paste-with-whitespace by design).
 *
 * On 200: clear local auth, navigate to /account-deleted (public).
 * On 403 (admin self-delete blocked): surface the admin-specific
 * message verbatim from the server. On any other error: generic
 * "contact support" toast.
 */
export function DeleteAccountPanel({ userId: _userId, email, role, onSignOut }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Case-insensitive: real users sometimes have inconsistent casing
  // in their typing. Trim-sensitive: a paste with stray whitespace
  // would suggest the user typed in the wrong place; better to make
  // them retype than silently accept.
  const emailMatches = deleteConfirmEmail.toLowerCase() === email.toLowerCase();

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    const { data, error } = await supabase.functions.invoke<{ error?: string; success?: boolean }>(
      "delete-self",
      { body: {} },
    );
    setDeleteLoading(false);

    // Two error shapes can arrive: (a) supabase-js wraps non-2xx
    // responses in `error`, (b) the function itself returns a JSON
    // body with an `error` field. Inspect both.
    const serverError = error?.message || data?.error;
    if (serverError) {
      // Surface the admin-specific message verbatim so admins
      // understand why and what their alternative is. Other errors
      // are mapped to the generic copy — server-side logs carry the
      // detail without leaking internals.
      const isAdminBlocked = /admins cannot self-delete/i.test(serverError);
      toast({
        title: "Could not delete account",
        description: isAdminBlocked
          ? serverError
          : "Could not delete account. Please contact support.",
        variant: "destructive",
      });
      return;
    }

    await onSignOut();
    navigate("/account-deleted");
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
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete My Account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Your Account — This Cannot Be Undone</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  This will permanently delete your account, your bookings,
                  and your profile. Your recorded volunteer hours will be
                  retained for reporting but will no longer be linked to
                  your name. This cannot be undone.
                </p>
                {role === "coordinator" && (
                  <p>
                    Your created shifts will remain on the schedule but
                    will no longer be attributed to you.
                  </p>
                )}
                <div className="pt-2">
                  <Label htmlFor="delete-confirm-email">
                    Type your email to confirm:
                  </Label>
                  <Input
                    id="delete-confirm-email"
                    className="mt-1"
                    value={deleteConfirmEmail}
                    onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                    placeholder={email}
                    autoComplete="off"
                  />
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteConfirmEmail("")}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!emailMatches || deleteLoading}
                onClick={handleDeleteAccount}
              >
                {deleteLoading ? "Deleting..." : "Delete my account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
