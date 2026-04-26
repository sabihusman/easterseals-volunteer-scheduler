/**
 * Profile fields the Settings panels read that the supabase type generator
 * hasn't picked up yet. Same pattern as `AlertProfile` in
 * `src/components/volunteer/DashboardAlerts.tsx` — narrow extension that
 * lets panels avoid scattering `(profile as any).field` access points.
 *
 * Page bridges with `profile as unknown as SettingsProfile` once at the
 * panel boundary.
 */
export interface SettingsProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  avatar_url: string | null;
  notif_email: boolean;
  notif_in_app: boolean;
  notif_sms: boolean;
  // Columns the type generator hasn't surfaced:
  date_of_birth: string | null;
  is_minor: boolean;
  username: string | null;
  notif_shift_reminders: boolean | null;
  notif_new_messages: boolean | null;
  notif_milestone: boolean | null;
  notif_document_expiry: boolean | null;
  notif_booking_changes: boolean | null;
}
