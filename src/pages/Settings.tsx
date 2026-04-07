import { useState, useEffect, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Lock, Trash2, Shield, Upload, X, AtSign, Check } from "lucide-react";
import Avatar from "@/components/Avatar";
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

  // Avatar
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Profile
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  // Username
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid" | "unchanged">("idle");
  const [usernameSaving, setUsernameSaving] = useState(false);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // Notifications
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifInApp, setNotifInApp] = useState(true);
  const [notifSms, setNotifSms] = useState(false);

  // Per-type notification preferences
  const [notifShiftReminders, setNotifShiftReminders] = useState(true);
  const [notifNewMessages, setNotifNewMessages] = useState(true);
  const [notifMilestone, setNotifMilestone] = useState(true);
  const [notifDocumentExpiry, setNotifDocumentExpiry] = useState(true);
  const [notifBookingChanges, setNotifBookingChanges] = useState(true);

  // MFA
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaEnrollFactorId, setMfaEnrollFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaDialogOpen, setMfaDialogOpen] = useState(false);

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
      setNotifShiftReminders((profile as any).notif_shift_reminders ?? true);
      setNotifNewMessages((profile as any).notif_new_messages ?? true);
      setNotifMilestone((profile as any).notif_milestone ?? true);
      setNotifDocumentExpiry((profile as any).notif_document_expiry ?? true);
      setNotifBookingChanges((profile as any).notif_booking_changes ?? true);
      const un = (profile as any).username ?? null;
      setCurrentUsername(un);
      setUsernameInput(un ?? "");
      setUsernameStatus(un ? "unchanged" : "idle");
    }
  }, [profile]);

  // Debounced username availability check
  useEffect(() => {
    const trimmed = usernameInput.trim();
    if (!trimmed) { setUsernameStatus("idle"); return; }
    if (trimmed === (currentUsername ?? "")) { setUsernameStatus("unchanged"); return; }
    if (!/^[A-Za-z0-9_]{3,30}$/.test(trimmed)) { setUsernameStatus("invalid"); return; }

    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      const { data: available } = await (supabase as any).rpc("username_available", { p_username: trimmed });
      setUsernameStatus(available ? "available" : "taken");
    }, 400);
    return () => clearTimeout(timer);
  }, [usernameInput, currentUsername]);

  const handleSaveUsername = async () => {
    if (!user) return;
    const trimmed = usernameInput.trim();
    if (!trimmed || usernameStatus !== "available") return;
    setUsernameSaving(true);
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ username: trimmed, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    setUsernameSaving(false);
    if (error) {
      // Unique violation is possible if someone grabbed it between check and save
      if ((error as any).code === "23505") {
        setUsernameStatus("taken");
        toast({ title: "Username taken", description: "Please choose a different username.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: (error as any).message, variant: "destructive" });
      }
      return;
    }
    setCurrentUsername(trimmed);
    setUsernameStatus("unchanged");
    toast({ title: "Username updated", description: `You can now sign in with @${trimmed}.` });
    refreshProfile();
  };

  // ── MFA Status ──
  useEffect(() => {
    const checkMfa = async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (data?.totp && data.totp.length > 0) {
        const verified = data.totp.find((f) => f.status === "verified");
        if (verified) {
          setMfaEnrolled(true);
          setMfaFactorId(verified.id);
        }
      }
    };
    checkMfa();
  }, []);

  const handleEnableMfa = async () => {
    setMfaLoading(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setMfaLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    if (data) {
      setMfaQrCode(data.totp.qr_code);
      setMfaEnrollFactorId(data.id);
      setMfaDialogOpen(true);
    }
  };

  const handleVerifyMfaEnrollment = async () => {
    if (!mfaEnrollFactorId || mfaCode.length !== 6) return;
    setMfaLoading(true);
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaEnrollFactorId });
    if (challengeError) {
      setMfaLoading(false);
      toast({ title: "Error", description: challengeError.message, variant: "destructive" });
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaEnrollFactorId,
      challengeId: challengeData.id,
      code: mfaCode,
    });
    setMfaLoading(false);
    if (verifyError) {
      toast({ title: "Verification failed", description: verifyError.message, variant: "destructive" });
      setMfaCode("");
      return;
    }
    setMfaEnrolled(true);
    setMfaFactorId(mfaEnrollFactorId);
    setMfaDialogOpen(false);
    setMfaQrCode(null);
    setMfaCode("");
    toast({ title: "2FA enabled", description: "Two-factor authentication is now active on your account." });
  };

  const handleRemoveMfa = async () => {
    if (!mfaFactorId) return;
    setMfaLoading(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
    setMfaLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setMfaEnrolled(false);
    setMfaFactorId(null);
    toast({ title: "2FA removed", description: "Two-factor authentication has been disabled." });
  };

  // ── Avatar Upload ──
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please choose an image under 2 MB.", variant: "destructive" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setAvatarUploading(true);
    const ext = file.name.split(".").pop() ?? "png";
    const path = `avatars/${user.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("volunteer-documents")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const { data: urlData } = supabase.storage
      .from("volunteer-documents")
      .getPublicUrl(path);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: urlData.publicUrl, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    if (updateError) {
      toast({ title: "Error", description: updateError.message, variant: "destructive" });
    } else {
      toast({ title: "Photo updated", description: "Your avatar has been uploaded." });
    }

    await refreshProfile();
    setAvatarUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAvatarRemove = async () => {
    if (!user) return;
    setAvatarUploading(true);

    // Remove from storage (best-effort; the folder may have multiple extensions)
    const { data: files } = await supabase.storage
      .from("volunteer-documents")
      .list(`avatars/${user.id}`);

    if (files && files.length > 0) {
      const paths = files.map((f) => `avatars/${user.id}/${f.name}`);
      await supabase.storage.from("volunteer-documents").remove(paths);
    }

    await supabase
      .from("profiles")
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    await refreshProfile();
    setAvatarUploading(false);
    toast({ title: "Photo removed", description: "Your avatar has been removed." });
  };

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
          {/* Avatar Upload */}
          <div className="flex items-center gap-4">
            <Avatar avatarUrl={profile?.avatar_url} fullName={profile?.full_name || "User"} size="lg" />
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={avatarUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {avatarUploading ? "Uploading..." : "Upload Photo"}
              </Button>
              {profile?.avatar_url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={avatarUploading}
                  onClick={handleAvatarRemove}
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Remove Photo
                </Button>
              )}
            </div>
          </div>
          <Separator />
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

      {/* ── Username ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AtSign className="h-4 w-4" /> Username</CardTitle>
          <CardDescription>
            Pick a unique username you can use to sign in instead of your email. 3-30 characters, letters, numbers, and underscores only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentUsername && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              Current username: <strong>@{currentUsername}</strong>
            </div>
          )}
          <div className="space-y-2">
            <Label>Username</Label>
            <div className="relative">
              <AtSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="e.g. jane_doe"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                maxLength={30}
                autoComplete="off"
              />
            </div>
            {usernameStatus === "checking" && (
              <p className="text-xs text-muted-foreground">Checking availability...</p>
            )}
            {usernameStatus === "available" && (
              <p className="text-xs text-primary flex items-center gap-1">
                <Check className="h-3 w-3" /> Available
              </p>
            )}
            {usernameStatus === "taken" && (
              <p className="text-xs text-destructive">That username is already taken.</p>
            )}
            {usernameStatus === "invalid" && (
              <p className="text-xs text-destructive">Use 3-30 letters, numbers, or underscores.</p>
            )}
            {usernameStatus === "unchanged" && currentUsername && (
              <p className="text-xs text-muted-foreground">This is your current username.</p>
            )}
          </div>
          <Button
            onClick={handleSaveUsername}
            disabled={usernameSaving || usernameStatus !== "available"}
          >
            {usernameSaving ? "Saving..." : currentUsername ? "Update Username" : "Set Username"}
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

      {/* ── Security / MFA ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Two-Factor Authentication</CardTitle>
          <CardDescription>Add an extra layer of security to your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mfaEnrolled ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
                <p className="text-sm text-muted-foreground">2FA is enabled on your account</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleRemoveMfa} disabled={mfaLoading}>
                {mfaLoading ? "Removing..." : "Remove 2FA"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Protect your account with a TOTP authenticator app</p>
              <Dialog open={mfaDialogOpen} onOpenChange={setMfaDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" onClick={handleEnableMfa} disabled={mfaLoading}>
                    {mfaLoading ? "Setting up..." : "Enable 2FA"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
                    <DialogDescription>Scan the QR code with your authenticator app, then enter the 6-digit code.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    {mfaQrCode && (
                      <div className="flex justify-center">
                        <img src={mfaQrCode} alt="MFA QR Code" className="w-48 h-48" />
                      </div>
                    )}
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="000000"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="text-center text-xl tracking-widest"
                    />
                    <Button className="w-full" onClick={handleVerifyMfaEnrollment} disabled={mfaLoading || mfaCode.length !== 6}>
                      {mfaLoading ? "Verifying..." : "Verify & Enable"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
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
          <Separator />
          <p className="text-sm font-medium">Notify me about...</p>
          <p className="text-xs text-muted-foreground">These preferences control email and SMS delivery. In-app notifications are always shown.</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Shift reminders</p>
              <p className="text-xs text-muted-foreground">24h and 2h shift reminders</p>
            </div>
            <Switch
              checked={notifShiftReminders}
              onCheckedChange={(v) => { setNotifShiftReminders(v); updateNotif("notif_shift_reminders", v); }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">New messages</p>
              <p className="text-xs text-muted-foreground">When you receive a new message</p>
            </div>
            <Switch
              checked={notifNewMessages}
              onCheckedChange={(v) => { setNotifNewMessages(v); updateNotif("notif_new_messages", v); }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Milestones & badges</p>
              <p className="text-xs text-muted-foreground">Hours milestones and achievements</p>
            </div>
            <Switch
              checked={notifMilestone}
              onCheckedChange={(v) => { setNotifMilestone(v); updateNotif("notif_milestone", v); }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Document expiry</p>
              <p className="text-xs text-muted-foreground">Document expiration warnings</p>
            </div>
            <Switch
              checked={notifDocumentExpiry}
              onCheckedChange={(v) => { setNotifDocumentExpiry(v); updateNotif("notif_document_expiry", v); }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Booking changes</p>
              <p className="text-xs text-muted-foreground">Confirmations, cancellations, waitlist updates</p>
            </div>
            <Switch
              checked={notifBookingChanges}
              onCheckedChange={(v) => { setNotifBookingChanges(v); updateNotif("notif_booking_changes", v); }}
            />
          </div>
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
