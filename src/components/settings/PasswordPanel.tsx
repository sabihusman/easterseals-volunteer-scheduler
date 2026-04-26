import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getPasswordStrength } from "@/lib/password-strength";

/**
 * Change-password panel. Owns its own form state — no props needed.
 * Validation rules: ≥8 chars, at least one letter, at least one digit,
 * confirm matches.
 */
export function PasswordPanel() {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const pwStrength = getPasswordStrength(newPassword);
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const pwMatch = newPassword === confirmNewPassword && confirmNewPassword.length > 0;
  const canChangePw = newPassword.length >= 8 && hasLetter && hasNumber && pwMatch;

  const handleChangePassword = async () => {
    if (!canChangePw) return;
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password updated", description: "Your password has been changed." });
      setNewPassword("");
      setConfirmNewPassword("");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Change Password</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>New Password</Label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          {newPassword.length > 0 && (
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all ${pwStrength.color} ${pwStrength.width}`} />
              </div>
              <p className="text-xs text-muted-foreground">Strength: {pwStrength.label}</p>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>Confirm New Password</Label>
          <Input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} />
          {confirmNewPassword.length > 0 && !pwMatch && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </div>
        <Button onClick={handleChangePassword} disabled={pwLoading || !canChangePw}>
          {pwLoading ? "Updating..." : "Update Password"}
        </Button>
      </CardContent>
    </Card>
  );
}
