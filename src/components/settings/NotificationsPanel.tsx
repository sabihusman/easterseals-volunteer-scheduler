import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { SettingsProfile } from "./types";

interface Props {
  userId: string;
  profile: SettingsProfile;
  /** Live (un-saved) phone fields from ProfilePanel — gate the SMS toggle. */
  phone: string;
  emergencyPhone: string;
  onSaved: () => Promise<void> | void;
}

/**
 * Notification preferences. Auto-saves on every toggle (no Save button).
 * Reads phone + emergency_phone from the parent's lifted state so a freshly-
 * typed (un-saved) phone immediately enables the SMS toggle — preserves the
 * pre-refactor UX.
 */
export function NotificationsPanel({ userId, profile, phone, emergencyPhone, onSaved }: Props) {
  // Channel toggles
  const [notifEmail, setNotifEmail] = useState(profile.notif_email);
  const [notifInApp, setNotifInApp] = useState(profile.notif_in_app);
  const [notifSms, setNotifSms] = useState(profile.notif_sms);
  // Per-type toggles
  const [notifShiftReminders, setNotifShiftReminders] = useState<boolean>(profile.notif_shift_reminders ?? true);
  const [notifNewMessages, setNotifNewMessages] = useState<boolean>(profile.notif_new_messages ?? true);
  const [notifMilestone, setNotifMilestone] = useState<boolean>(profile.notif_milestone ?? true);
  const [notifDocumentExpiry, setNotifDocumentExpiry] = useState<boolean>(profile.notif_document_expiry ?? true);
  const [notifBookingChanges, setNotifBookingChanges] = useState<boolean>(profile.notif_booking_changes ?? true);

  // Re-sync when the parent receives a fresh profile
  useEffect(() => {
    setNotifEmail(profile.notif_email);
    setNotifInApp(profile.notif_in_app);
    setNotifSms(profile.notif_sms);
    setNotifShiftReminders(profile.notif_shift_reminders ?? true);
    setNotifNewMessages(profile.notif_new_messages ?? true);
    setNotifMilestone(profile.notif_milestone ?? true);
    setNotifDocumentExpiry(profile.notif_document_expiry ?? true);
    setNotifBookingChanges(profile.notif_booking_changes ?? true);
  }, [profile]);

  const updateNotif = async (field: string, value: boolean) => {
    await supabase
      .from("profiles")
      .update({ [field]: value, updated_at: new Date().toISOString() } as never)
      .eq("id", userId);
    await onSaved();
  };

  return (
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
  );
}
