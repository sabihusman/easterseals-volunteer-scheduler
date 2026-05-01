import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { AvatarUploadField } from "./AvatarUploadField";
import type { SettingsProfile } from "./types";

interface Props {
  userId: string;
  profile: SettingsProfile;
  /** Cross-cutting state — lifted to the page so NotificationsPanel/ParentalConsentPanel react before save. */
  phone: string;
  setPhone: (v: string) => void;
  emergencyPhone: string;
  setEmergencyPhone: (v: string) => void;
  /**
   * Read-only here. is_minor is now answered once at signup (over-18
   * radio in Auth.tsx) and is not editable from this panel — see
   * migration 20260501000000_remove_dob_capture.sql. Settings.tsx still
   * passes it down because ParentalConsentPanel visibility depends on
   * it, but this panel no longer mutates it.
   */
  isMinor: boolean;
  /** Called after a successful save so the parent can refreshProfile(). */
  onSaved: () => Promise<void> | void;
}

/**
 * Profile information panel: avatar, display name, email (with auth update),
 * phone, and emergency contact.
 *
 * Phone/emergencyPhone are lifted to the page so NotificationsPanel can
 * react to in-progress edits before the user clicks Save. isMinor is read
 * but no longer mutated here — Half A removed DOB capture in favor of a
 * one-time signup question.
 */
export function ProfilePanel({
  userId, profile,
  phone, setPhone,
  emergencyPhone, setEmergencyPhone,
  isMinor: _isMinor,
  onSaved,
}: Props) {
  const { toast } = useToast();

  const [fullName, setFullName] = useState(profile.full_name || "");
  const [email, setEmail] = useState(profile.email || "");
  const [emergencyName, setEmergencyName] = useState(profile.emergency_contact_name || "");
  const [loading, setLoading] = useState(false);

  // Re-sync local form state when a fresh profile arrives.
  useEffect(() => {
    setFullName(profile.full_name || "");
    setEmail(profile.email || "");
    setEmergencyName(profile.emergency_contact_name || "");
  }, [profile]);

  const handleSave = async () => {
    setLoading(true);

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        phone: phone || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", userId);

    if (profileError) {
      toast({ title: "Error", description: profileError.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // If email changed, update auth
    if (email !== profile.email) {
      const { error: authError } = await supabase.auth.updateUser({ email });
      if (authError) {
        toast({ title: "Error updating email", description: authError.message, variant: "destructive" });
        setLoading(false);
        return;
      }
      toast({ title: "Verification sent", description: "Check your new email to confirm the change." });
    } else {
      toast({ title: "Profile updated", description: "Your profile has been saved." });
    }

    await onSaved();
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <AvatarUploadField
          userId={userId}
          avatarUrl={profile.avatar_url}
          fullName={profile.full_name || "User"}
          onChanged={onSaved}
        />
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
        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
