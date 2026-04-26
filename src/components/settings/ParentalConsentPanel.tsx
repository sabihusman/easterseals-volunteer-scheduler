import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ConsentStatus = "none" | "active" | "expiring";

interface Props {
  userId: string;
}

const ONE_YEAR_MS = 365 * 86400000;

/**
 * Parental consent panel for minors. Self-loads the most recent active
 * consent on mount, exposes a save/update flow that deactivates prior
 * consents and inserts a new one with a 1-year expiry.
 *
 * Caller decides when to render this (when isMinor is true).
 */
export function ParentalConsentPanel({ userId }: Props) {
  const { toast } = useToast();
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>("none");
  const [saving, setSaving] = useState(false);

  // Load existing active consent on mount.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("parental_consents")
      .select("*")
      .eq("volunteer_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (cancelled || !data || data.length === 0) return;
        const c = data[0] as any;
        setParentName(c.parent_name || "");
        setParentEmail(c.parent_email || "");
        setParentPhone(c.parent_phone || "");
        const expires = c.expires_at ? new Date(c.expires_at) : null;
        if (!expires || expires > new Date()) {
          const daysLeft = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : 999;
          setConsentStatus(daysLeft <= 30 ? "expiring" : "active");
        } else {
          setConsentStatus("none");
        }
      });
    return () => { cancelled = true; };
  }, [userId]);

  const handleSubmit = async () => {
    if (!parentName.trim() || !parentEmail.trim()) {
      toast({ title: "Required", description: "Parent name and email are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Deactivate any existing consent
    await (supabase as any).from("parental_consents").update({ is_active: false }).eq("volunteer_id", userId);
    // Insert new consent with 1-year expiry
    const { error } = await (supabase as any).from("parental_consents").insert({
      volunteer_id: userId,
      parent_name: parentName.trim(),
      parent_email: parentEmail.trim(),
      parent_phone: parentPhone.trim() || null,
      consent_method: "digital",
      expires_at: new Date(Date.now() + ONE_YEAR_MS).toISOString(),
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Parental consent submitted", description: "Consent is now on file. Valid for 1 year." });
      setConsentStatus("active");
    }
  };

  return (
    <Card className="border-warning/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-warning" /> Parental Consent
          {consentStatus === "active" && <Badge className="ml-auto bg-primary text-primary-foreground text-xs">Consent on file</Badge>}
          {consentStatus === "expiring" && <Badge className="ml-auto bg-yellow-500 text-white text-xs">Consent expiring</Badge>}
          {consentStatus === "none" && <Badge variant="destructive" className="ml-auto text-xs">Consent required</Badge>}
        </CardTitle>
        <CardDescription>
          Volunteers under 18 must have a parent or guardian consent on file before booking shifts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Parent/Guardian Full Name *</Label>
          <Input placeholder="Jane Doe" value={parentName} onChange={(e) => setParentName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Parent/Guardian Email *</Label>
          <Input type="email" placeholder="parent@example.com" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Parent/Guardian Phone</Label>
          <Input type="tel" placeholder="(XXX) XXX-XXXX" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={saving || !parentName.trim() || !parentEmail.trim()}
        >
          {saving ? "Saving..." : consentStatus === "active" ? "Update Consent" : "Submit Consent"}
        </Button>
      </CardContent>
    </Card>
  );
}
