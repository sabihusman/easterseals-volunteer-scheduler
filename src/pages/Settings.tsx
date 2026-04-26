import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ProfilePanel } from "@/components/settings/ProfilePanel";
import { ParentalConsentPanel } from "@/components/settings/ParentalConsentPanel";
import { UsernamePanel } from "@/components/settings/UsernamePanel";
import { PasswordPanel } from "@/components/settings/PasswordPanel";
import { MfaPanel } from "@/components/settings/MfaPanel";
import { NotificationsPanel } from "@/components/settings/NotificationsPanel";
import { DeleteAccountPanel } from "@/components/settings/DeleteAccountPanel";
import type { SettingsProfile } from "@/components/settings/types";

/**
 * Settings page — thin orchestrator. Each panel owns its own form state.
 *
 * Three pieces of cross-panel state live here:
 *   - phone, emergencyPhone — read by NotificationsPanel to gate the SMS
 *     toggle. Lifting preserves the pre-refactor UX where typing a phone in
 *     the profile form enables SMS *before* save.
 *   - isMinor — drives ParentalConsentPanel visibility. Lifted so the consent
 *     panel appears immediately when DOB is changed to a minor's birthday.
 */
export default function Settings() {
  const { user, profile, session, role, signOut, refreshProfile } = useAuth();

  const [phone, setPhone] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [isMinor, setIsMinor] = useState(false);

  // Sync the lifted cross-panel state when a fresh profile arrives.
  useEffect(() => {
    if (!profile) return;
    setPhone(profile.phone || "");
    setEmergencyPhone(profile.emergency_contact_phone || "");
    setIsMinor((profile as unknown as SettingsProfile).is_minor === true);
  }, [profile]);

  const lastSignIn = session?.user?.last_sign_in_at
    ? format(new Date(session.user.last_sign_in_at), "MMM d, yyyy 'at' h:mm a")
    : "Unknown";

  if (!user || !profile) return null;

  // The supabase generated Profile type doesn't model is_minor / username /
  // notif_* / date_of_birth — bridge with SettingsProfile here. Same boundary-
  // cast pattern as AlertProfile in src/components/volunteer/DashboardAlerts.tsx.
  const settingsProfile = profile as unknown as SettingsProfile;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <ProfilePanel
        userId={user.id}
        profile={settingsProfile}
        phone={phone}
        setPhone={setPhone}
        emergencyPhone={emergencyPhone}
        setEmergencyPhone={setEmergencyPhone}
        isMinor={isMinor}
        setIsMinor={setIsMinor}
        onSaved={refreshProfile}
      />

      {isMinor && <ParentalConsentPanel userId={user.id} />}

      <UsernamePanel
        userId={user.id}
        initialUsername={settingsProfile.username}
        onSaved={refreshProfile}
      />

      <PasswordPanel />

      <MfaPanel />

      <NotificationsPanel
        userId={user.id}
        profile={settingsProfile}
        phone={phone}
        emergencyPhone={emergencyPhone}
        onSaved={refreshProfile}
      />

      {role !== "admin" && (
        <DeleteAccountPanel
          userId={user.id}
          email={profile.email ?? ""}
          role={role}
          onSignOut={signOut}
        />
      )}

      <p className="text-xs text-muted-foreground text-center pb-4">
        Last signed in: {lastSignIn}
      </p>
    </div>
  );
}
