/**
 * Pure predicate that decides whether a single notification row should
 * cause an SMS to be sent. The Deno notification-webhook function
 * (supabase/functions/notification-webhook/index.ts) implements the
 * SAME logic — they're kept in sync by the unit tests in
 * `notification-sms-gate.test.ts`, which pin every state combination
 * the webhook would see.
 *
 * Three independent flags must ALL be on for SMS to fire:
 *
 *   1. globalSmsEnabled — process-level kill switch (env: SMS_ENABLED).
 *      Twilio's sending number is not yet verified for our destination
 *      numbers, so this is currently false in production.
 *   2. perUserSmsPref — the volunteer's notif_sms toggle.
 *   3. perNotificationEligible — derived from data.sms_eligible.
 *      undefined/null means "respect default true" so legacy types
 *      (shift_reminder, etc.) keep sending without code changes.
 *      Explicit false suppresses SMS while leaving email + in-app
 *      enabled — used by shift_cancelled when the shift is 24h+ out.
 *
 * Two override paths bypass the per-user pref AND the per-notification
 * eligibility flag:
 *
 *   - isUrgentWaitlistOffer: a waitlist-offer notification with
 *     window_minutes < 30. Volunteer needs maximum chance of seeing
 *     the offer before it expires.
 *
 * Neither override skips the global kill switch. If SMS_ENABLED is
 * false, NO SMS goes out, period.
 */

export interface SmsGateInputs {
  /** SMS_ENABLED env flag, post-coercion to boolean. */
  globalSmsEnabled: boolean;
  /** Profile.notif_sms — null/undefined treated as off. */
  perUserSmsPref: boolean | null | undefined;
  /**
   * data.sms_eligible from the notification row. Tristate: undefined,
   * null, true, false. undefined/null means "respect default true".
   */
  perNotificationEligible: boolean | null | undefined;
  /** Override path: urgent (<30 min) waitlist offer. */
  isUrgentWaitlistOffer: boolean;
  /** Whether the volunteer has a phone number on file. */
  hasPhone: boolean;
}

export function shouldSendSms(inputs: SmsGateInputs): boolean {
  const {
    globalSmsEnabled,
    perUserSmsPref,
    perNotificationEligible,
    isUrgentWaitlistOffer,
    hasPhone,
  } = inputs;

  // Hard requirements that NO override can bypass.
  if (!globalSmsEnabled) return false;
  if (!hasPhone) return false;

  // Per-notification eligibility. undefined/null is "default eligible".
  // Only an explicit `false` blocks the path — and even then the urgent
  // waitlist override beats it.
  const explicitlyIneligible = perNotificationEligible === false;
  if (explicitlyIneligible && !isUrgentWaitlistOffer) return false;

  // Per-user pref. `false` blocks unless overridden by urgent waitlist.
  const userOptedOut = perUserSmsPref === false;
  if (userOptedOut && !isUrgentWaitlistOffer) return false;

  return true;
}
