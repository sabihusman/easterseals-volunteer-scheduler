import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, XCircle } from "lucide-react";

/**
 * Profile fields the alert panel reads. The `is_minor` and
 * `has_active_consent` columns aren't picked up by the supabase type
 * generator yet, so the page passes them via this extension type rather
 * than scattering `(profile as any)` access points.
 */
export interface AlertProfile {
  bg_check_status: string | null;
  booking_privileges: boolean | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_minor?: boolean;
  has_active_consent?: boolean;
}

interface Props {
  profile: AlertProfile;
}

/**
 * Stack of dashboard banners — privileges suspended, BG check failed/expired,
 * missing emergency contact, minor parental-consent state. Renders nothing
 * if all conditions are clear.
 */
export function DashboardAlerts({ profile }: Props) {
  const privilegesSuspended = profile.booking_privileges === false;
  const bgFailed = profile.bg_check_status === "failed" || profile.bg_check_status === "expired";
  const missingEmergencyContact = !profile.emergency_contact_name || !profile.emergency_contact_phone;
  return (
    <>
      {privilegesSuspended && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Booking Privileges Suspended</AlertTitle>
          <AlertDescription>Your booking privileges have been suspended. Please contact your coordinator.</AlertDescription>
        </Alert>
      )}

      {!privilegesSuspended && bgFailed && (
        <Alert className="border-warning/50 bg-warning/10 text-warning-foreground">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Background Check {profile.bg_check_status === "expired" ? "Expired" : "Failed"}</AlertTitle>
          <AlertDescription>Your background check status is {profile.bg_check_status}. You cannot book shifts that require a background check until this is resolved.</AlertDescription>
        </Alert>
      )}

      {missingEmergencyContact && (
        <Alert className="border-warning/50 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle>Emergency Contact Required</AlertTitle>
          <AlertDescription>
            Please add an emergency contact before booking shifts. This is required for insurance and liability.{" "}
            <a href="/settings" className="text-primary font-medium underline">Go to Settings →</a>
          </AlertDescription>
        </Alert>
      )}

      {profile.is_minor && (
        <Alert className={profile.has_active_consent ? "border-primary/50 bg-primary/5" : "border-destructive/50 bg-destructive/10"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{profile.has_active_consent ? "Parental Consent on File" : "Parental Consent Required"}</AlertTitle>
          <AlertDescription>
            {profile.has_active_consent
              ? "Your parent/guardian's consent is on file. You're cleared to book shifts."
              : <>Volunteers under 18 need parental consent before booking shifts. <a href="/settings" className="text-primary font-medium underline">Go to Settings →</a></>
            }
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
