import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Lock, Trash2 } from "lucide-react";
import { format } from "date-fns";

function getPasswordStrength(pw: string) {
  if (pw.length < 8) return { label: "Too short", color: "bg-destructive", width: "w-1/4" };
  const hasLetter = /[a-zA-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
  const score = [hasLetter, hasNumber, hasSpecial, pw.length >= 12].filter(Boolean).length;
  if (score <= 1) return { label: "Weak", color: "bg-destructive", width: "w-1/4" };
  if (score === 2) return { label: "Fair", color: "bg-amber-500", width: "w-2/4" };
  return { label: "Strong", color: "bg-primary", width: "w-full" };
}

export default function Settings() {
  const { user, profile, session, role, signOut, refreshProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Profile
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // Notifications
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifInApp, setNotifInApp] = useState(true);
  const [notifSms, setNotifSms] = useState(false);

  // Delete
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setEmail(profile.email || "");
      setPhone(profile.phone || "");
      setEmergencyName(profile.emergency_contact_name || "");
      setEmergencyPhone(profile.emergency_contact_phone || "");
      setNotifEmail(profile.notif_email);
      setNotifInApp(profile.notif_in_app);
      setNotifSms(profile.notif_sms);
    }
  }, [profile]);

  // ── Profile Save ──
  const handleSaveProfile = async () => {
    if (!user) return;
    setProfileLoading(true);

    // Update profiles table
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        phone: phone || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (profileError) {
      toast({ title: "Error", description: profileError.message, variant: "destructive" });
      setProfileLoading(false);
      return;
    }

    // If email changed, update auth
    if (email !== profile?.email) {
      const { error: authError } = await supabase.auth.updateUser({ email });
      if (authError) {
        toast({ title: "Error updating email", description: authError.message, variant: "destructive" });
        setProfileLoading(false);
        return;
      }
      toast({ title: "Verification sent", description: "Check your new email to confirm the change." });
    } else {
      toast({ title: "Profile updated", description: "Your profile has been saved." });
    }

    await refreshProfile();
    setProfileLoading(false);
  };

  // ── Password Change ──
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

  // ── Notification Toggles (auto-save) ──
  const updateNotif = async (field: string, value: boolean) => {
    if (!user) return;
    await supabase.from("profiles").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", user.id);
    await refreshProfile();
  };

  // ── Delete Account ──
  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeleteLoading(true);
    const { error } = await supabase.functions.invoke("delete-user", {
      body: { userId: user.id },
    });
    setDeleteLoading(false);
    if (error) {
      toast({ title: "Error", description: "Could not delete account. Please contact support.", variant: "destructive" });
      return;
    }
    await signOut();
    navigate("/auth", { state: { accountDeleted: true } });
  };

  const lastSignIn = session?.user?.last_sign_in_at
    ? format(new Date(session.user.last_sign_in_at), "MMM d, yyyy 'at' h:mm a")
    : "Unknown";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* ── Profile ── */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email Address</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="text-xs text-muted-foreground">Changing your email will require verification of the new address.</p>
          </div>
          <div className="space-y-2">
            <Label>Phone Number</Label>
            <Input type="tel" placeholder="(XXX) XXX-XXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Separator />
          <p className="text-sm font-medium text-muted-foreground">Emergency Contact</p>
          <div className="space-y-2">
            <Label>Emergency Contact Name</Label>
            <Input placeholder="Jane Doe" value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Emergency Contact Phone</Label>
            <Input type="tel" placeholder="(XXX) XXX-XXXX" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
          </div>
          <Button onClick={handleSaveProfile} disabled={profileLoading}>
            {profileLoading ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Password ── */}
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

      {/* ── Notifications ── */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
          <CardDescription>How would you like to be notified?</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email notifications</p>
              <p className="text-xs text-muted-foreground">Shift confirmations, reminders, cancellations</p>
            </div>
            <Switch
              checked={notifEmail}
              onCheckedChange={(v) => { setNotifEmail(v); updateNotif("notif_email", v); }}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">In-app notifications</p>
              <p className="text-xs text-muted-foreground">Bell icon alerts within the app</p>
            </div>
            <Switch
              checked={notifInApp}
              onCheckedChange={(v) => { setNotifInApp(v); updateNotif("notif_in_app", v); }}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">SMS / Text notifications</p>
              <p className="text-xs text-muted-foreground">
                {phone || emergencyPhone ? "Shift reminders, cancellations, and messages via text" : "Add a phone number above to enable SMS"}
              </p>
            </div>
            <Switch
              checked={notifSms}
              disabled={!phone && !emergencyPhone}
              onCheckedChange={(v) => { setNotifSms(v); updateNotif("notif_sms", v); }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            You will be notified for: shift confirmations, reminders, cancellations, and milestone achievements.
          </p>
        </CardContent>
      </Card>

      {/* ── Delete Account (not for admins) ── */}
      {role !== "admin" && (
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
                        placeholder={profile?.email}
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={deleteConfirmEmail !== profile?.email || deleteLoading}
                    onClick={handleDeleteAccount}
                  >
                    {deleteLoading ? "Deleting..." : "Delete My Account"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}

      {/* ── Last Login ── */}
      <p className="text-xs text-muted-foreground text-center pb-4">
        Last signed in: {lastSignIn}
      </p>
    </div>
  );
}
