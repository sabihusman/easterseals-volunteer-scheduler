import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ProfilePanel } from "@/components/settings/ProfilePanel";
import { UsernamePanel } from "@/components/settings/UsernamePanel";
import { PasswordPanel } from "@/components/settings/PasswordPanel";
import { MfaPanel } from "@/components/settings/MfaPanel";
import { NotificationsPanel } from "@/components/settings/NotificationsPanel";
import { DeleteAccountPanel } from "@/components/settings/DeleteAccountPanel";
import type { SettingsProfile } from "@/components/settings/types";

/**
 * Settings page — thin orchestrator. Each panel owns its own form state.
 *
 * Cross-panel state:
 *   - phone, emergencyPhone — read by NotificationsPanel to gate the SMS
 *     toggle. Lifting preserves the pre-refactor UX where typing a phone in
 *     the profile form enables SMS *before* save.
 *
 * Half B-1 removed the parental-consent panel entirely. Minor handling
 * now lives in the BEFORE INSERT trigger (routes minor bookings to
 * pending_admin_approval) and the /admin/pending-minor-approvals queue.
 * profiles.is_minor remains, but is purely informational on this page.
 */
export default function Settings() {
  const { user, profile, session, role, signOut, refreshProfile } = useAuth();

  const [phone, setPhone] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  // Sync the lifted cross-panel state when a fresh profile arrives.
  useEffect(() => {
    if (!profile) return;
    setPhone(profile.phone || "");
    setEmergencyPhone(profile.emergency_contact_phone || "");
  }, [profile]);

  const lastSignIn = session?.user?.last_sign_in_at
    ? format(new Date(session.user.last_sign_in_at), "MMM d, yyyy 'at' h:mm a")
    : "Unknown";

  if (!user || !profile) return null;

  // The supabase generated Profile type doesn't model is_minor / username /
  // notif_* — bridge with SettingsProfile here. Same boundary-cast pattern
  // as AlertProfile in src/components/volunteer/DashboardAlerts.tsx.
  const settingsProfile = profile as unknown as SettingsProfile;
  // is_minor is still surfaced to ProfilePanel as a read-only prop for
  // any future minor-aware UI in that panel; nothing on this page
  // branches on it after the parental-consent removal in Half B-1.
  const isMinor = settingsProfile.is_minor === true;

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
        onSaved={refreshProfile}
      />

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
