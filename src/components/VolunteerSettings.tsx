import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save, UserCog, ShieldAlert } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProfileData {
  full_name: string;
  phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
}

const PHONE_REGEX = /^\d{3}-\d{3}-\d{4}$/;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Format a raw digit string into xxx-xxx-xxxx as the user types. */
function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function VolunteerSettings() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData>({
    full_name: "",
    phone: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileData, string>>>({});

  /* ---------- Fetch profile on mount ---------- */

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "full_name, phone, emergency_contact_name, emergency_contact_phone"
        )
        .eq("id", user.id)
        .single();

      if (!error && data) {
        setProfile({
          full_name: data.full_name ?? "",
          phone: data.phone ?? "",
          emergency_contact_name: data.emergency_contact_name ?? "",
          emergency_contact_phone: data.emergency_contact_phone ?? "",
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  /* ---------- Validation ---------- */

  function validate(): boolean {
    const next: typeof errors = {};

    if (!profile.full_name.trim()) {
      next.full_name = "Full name is required.";
    }
    if (profile.phone && !PHONE_REGEX.test(profile.phone)) {
      next.phone = "Phone must be in xxx-xxx-xxxx format.";
    }
    if (
      profile.emergency_contact_phone &&
      !PHONE_REGEX.test(profile.emergency_contact_phone)
    ) {
      next.emergency_contact_phone =
        "Phone must be in xxx-xxx-xxxx format.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /* ---------- Save ---------- */

  async function handleSave() {
    if (!validate()) return;

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: profile.full_name.trim(),
        phone: profile.phone.trim() || null,
        emergency_contact_name:
          profile.emergency_contact_name.trim() || null,
        emergency_contact_phone:
          profile.emergency_contact_phone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    setSaving(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: error.message,
      });
    } else {
      toast({
        title: "Profile updated",
        description: "Your changes have been saved.",
      });
    }
  }

  /* ---------- Field updater ---------- */

  function update(field: keyof ProfileData, value: string) {
    setProfile((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[#006B3E]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* ---- Personal Info ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#006B3E]">
            <UserCog className="h-5 w-5" />
            Personal Information
          </CardTitle>
          <CardDescription>
            Update your name and contact number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Full Name */}
          <div className="space-y-1.5">
            <Label htmlFor="full_name">
              Full Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="full_name"
              value={profile.full_name}
              onChange={(e) => update("full_name", e.target.value)}
              placeholder="Jane Doe"
            />
            {errors.full_name && (
              <p className="text-xs text-red-500">{errors.full_name}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="numeric"
              value={profile.phone}
              onChange={(e) => update("phone", formatPhoneInput(e.target.value))}
              placeholder="515-555-0199"
            />
            {errors.phone && (
              <p className="text-xs text-red-500">{errors.phone}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- Emergency Contact ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#006B3E]">
            <ShieldAlert className="h-5 w-5" />
            Emergency Contact
          </CardTitle>
          <CardDescription>
            Provide an emergency contact so staff can reach someone on your
            behalf if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Emergency Contact Name */}
          <div className="space-y-1.5">
            <Label htmlFor="emergency_contact_name">
              Emergency Contact Name
            </Label>
            <Input
              id="emergency_contact_name"
              value={profile.emergency_contact_name}
              onChange={(e) =>
                update("emergency_contact_name", e.target.value)
              }
              placeholder="John Doe"
            />
          </div>

          {/* Emergency Contact Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="emergency_contact_phone">
              Emergency Contact Phone
            </Label>
            <Input
              id="emergency_contact_phone"
              type="tel"
              inputMode="numeric"
              value={profile.emergency_contact_phone}
              onChange={(e) =>
                update(
                  "emergency_contact_phone",
                  formatPhoneInput(e.target.value)
                )
              }
              placeholder="515-555-0100"
            />
            {errors.emergency_contact_phone && (
              <p className="text-xs text-red-500">
                {errors.emergency_contact_phone}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- Save ---- */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#006B3E] hover:bg-[#005a33]"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
