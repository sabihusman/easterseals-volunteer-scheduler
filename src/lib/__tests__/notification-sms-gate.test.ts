import { describe, it, expect } from "vitest";
import { shouldSendSms, type SmsGateInputs } from "@/lib/notification-sms-gate";

/**
 * Contract tests for the SMS-gate predicate.
 *
 * The Deno notification-webhook function implements the same predicate
 * inline (it can't import from src/ — different module system). This
 * test file is the canonical truth table; if the webhook drifts, these
 * tests should be updated and the webhook patched in lockstep.
 *
 * The PR brief required: "SMS via Twilio (only if cancellation is
 * within 24h of shift start time AND the SMS feature flag is enabled)."
 * That's modeled here as `perNotificationEligible: false` (long-lead
 * cancellation) and `globalSmsEnabled: false` (flag off) both
 * suppressing SMS.
 */

const BASE: SmsGateInputs = {
  globalSmsEnabled: true,
  perUserSmsPref: true,
  perNotificationEligible: true,
  isUrgentWaitlistOffer: false,
  hasPhone: true,
};

describe("shouldSendSms", () => {
  it("sends when all three gates are on and the user has a phone", () => {
    expect(shouldSendSms(BASE)).toBe(true);
  });

  describe("global SMS_ENABLED kill switch", () => {
    it("blocks when globalSmsEnabled is false, even with all overrides", () => {
      expect(
        shouldSendSms({
          ...BASE,
          globalSmsEnabled: false,
          isUrgentWaitlistOffer: true,
          perNotificationEligible: true,
          perUserSmsPref: true,
        }),
      ).toBe(false);
    });
  });

  describe("phone-on-file requirement", () => {
    it("blocks when the volunteer has no phone on file", () => {
      expect(shouldSendSms({ ...BASE, hasPhone: false })).toBe(false);
    });
    it("blocks even an urgent waitlist offer when no phone", () => {
      // Urgent overrides bypass user prefs but cannot conjure a phone
      // number out of thin air.
      expect(
        shouldSendSms({ ...BASE, hasPhone: false, isUrgentWaitlistOffer: true }),
      ).toBe(false);
    });
  });

  describe("per-notification eligibility flag (data.sms_eligible)", () => {
    it("undefined respects default true → SMS sends", () => {
      expect(
        shouldSendSms({ ...BASE, perNotificationEligible: undefined }),
      ).toBe(true);
    });
    it("null respects default true → SMS sends", () => {
      expect(shouldSendSms({ ...BASE, perNotificationEligible: null })).toBe(
        true,
      );
    });
    it("true sends", () => {
      expect(shouldSendSms({ ...BASE, perNotificationEligible: true })).toBe(
        true,
      );
    });
    it("explicit false blocks (24h+ shift_cancelled case)", () => {
      // This is the gate that satisfies the brief's "only if
      // cancellation is within 24h" requirement: the cancel helper
      // sets sms_eligible=false on long-lead cancellations.
      expect(shouldSendSms({ ...BASE, perNotificationEligible: false })).toBe(
        false,
      );
    });
    it("urgent waitlist override beats explicit false", () => {
      expect(
        shouldSendSms({
          ...BASE,
          perNotificationEligible: false,
          isUrgentWaitlistOffer: true,
        }),
      ).toBe(true);
    });
  });

  describe("per-user notif_sms preference", () => {
    it("false blocks", () => {
      expect(shouldSendSms({ ...BASE, perUserSmsPref: false })).toBe(false);
    });
    it("urgent waitlist override beats user opt-out", () => {
      expect(
        shouldSendSms({
          ...BASE,
          perUserSmsPref: false,
          isUrgentWaitlistOffer: true,
        }),
      ).toBe(true);
    });
  });

  describe("interaction grid (the cases the audit cares about)", () => {
    type Row = {
      label: string;
      input: Partial<SmsGateInputs>;
      expected: boolean;
    };

    const rows: Row[] = [
      // Long-lead cancellation: brief mandates "only if within 24h".
      {
        label: "long-lead cancellation, flag on, user opted in",
        input: { perNotificationEligible: false },
        expected: false,
      },
      // Within-24h cancellation, all green.
      {
        label: "urgent cancellation, flag on, user opted in",
        input: { perNotificationEligible: true },
        expected: true,
      },
      // Within-24h cancellation, but flag off (production today).
      {
        label: "urgent cancellation, flag OFF — feature unavailable",
        input: { perNotificationEligible: true, globalSmsEnabled: false },
        expected: false,
      },
      // User opted out of SMS, regular shift_reminder (default eligible).
      {
        label: "regular reminder, user opted out of SMS",
        input: { perNotificationEligible: undefined, perUserSmsPref: false },
        expected: false,
      },
    ];

    for (const { label, input, expected } of rows) {
      it(`${label} → ${expected ? "sends" : "blocks"}`, () => {
        expect(shouldSendSms({ ...BASE, ...input })).toBe(expected);
      });
    }
  });
});
