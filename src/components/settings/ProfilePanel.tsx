import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
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
  isMinor: boolean;
  setIsMinor: (v: boolean) => void;
  /** Called after a successful save so the parent can refreshProfile(). */
  onSaved: () => Promise<void> | void;
}

const MIN_AGE_MS = 13 * 365.25 * 86400000;

/**
 * Profile information panel: avatar, display name, email (with auth update),
 * phone, emergency contact, and date-of-birth (with minor detection).
 *
 * Phone/emergencyPhone/isMinor are lifted to the page so other panels can
 * react to in-progress edits before the user clicks Save.
 */
export function ProfilePanel({
  userId, profile,
  phone, setPhone,
  emergencyPhone, setEmergencyPhone,
  isMinor, setIsMinor,
  onSaved,
}: Props) {
  const { toast } = useToast();

  const [fullName, setFullName] = useState(profile.full_name || "");
  const [email, setEmail] = useState(profile.email || "");
  const [emergencyName, setEmergencyName] = useState(profile.emergency_contact_name || "");
  const [dateOfBirth, setDateOfBirth] = useState(profile.date_of_birth || "");
  const [loading, setLoading] = useState(false);

  // Re-sync local form state when a fresh profile arrives.
  useEffect(() => {
    setFullName(profile.full_name || "");
    setEmail(profile.email || "");
    setEmergencyName(profile.emergency_contact_name || "");
    setDateOfBirth(profile.date_of_birth || "");
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
        date_of_birth: dateOfBirth || null,
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
        <Separator />
        <p className="text-sm font-medium text-muted-foreground">Date of Birth</p>
        <div className="space-y-2">
          <Label>Date of Birth</Label>
          <Input
            type="date"
            value={dateOfBirth}
            onChange={(e) => {
              setDateOfBirth(e.target.value);
              if (e.target.value) {
                const age = (Date.now() - new Date(e.target.value).getTime()) / (365.25 * 86400000);
                setIsMinor(age < 18);
              } else {
                setIsMinor(false);
              }
            }}
            max={new Date(Date.now() - MIN_AGE_MS).toISOString().slice(0, 10)}
          />
          <p className="text-xs text-muted-foreground">Must be at least 13 years old to volunteer.</p>
          {isMinor && (
            <Badge className="bg-yellow-500 text-white">Under 18 — Parental consent required</Badge>
          )}
        </div>
        <Button onClick={handleSave} disabled={loading}>
          {loading ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
