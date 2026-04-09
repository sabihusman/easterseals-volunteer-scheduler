import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, X } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function OnboardingChecklist() {
  const { profile, user, refreshProfile } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!profile || profile.role !== "volunteer" || profile.onboarding_complete || dismissed) return null;

  const items = [
    {
      label: "Complete your profile",
      // profiles has emergency_contact_name and emergency_contact_phone
      // — the old `emergency_contact` field never existed, so this item
      // was permanently stuck incomplete.
      done: !!(
        profile.phone &&
        (profile as any).emergency_contact_name &&
        (profile as any).emergency_contact_phone
      ),
    },
    { label: "Review Code of Conduct", done: !!profile.tos_accepted_at },
    { label: "Upload required documents", done: false },
    { label: "Background check submission", done: profile.bg_check_status !== "pending" },
  ];

  const allDone = items.every((i) => i.done);

  const handleDismiss = async () => {
    if (!allDone) {
      // Hide the card for this session only — it will come back on
      // reload until every item is actually done. Previously dismiss
      // was permanent even if nothing was completed, letting users
      // skip onboarding entirely.
      setDismissed(true);
      return;
    }
    if (user) {
      await supabase.from("profiles").update({ onboarding_complete: true }).eq("id", user.id);
      refreshProfile();
    }
    setDismissed(true);
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Getting Started</CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleDismiss} aria-label="Dismiss checklist">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-sm">
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className={item.done ? "line-through text-muted-foreground" : ""}>{item.label}</span>
            </li>
          ))}
        </ul>
        {allDone && (
          <Button className="w-full mt-3" size="sm" onClick={handleDismiss}>
            Complete Onboarding
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
