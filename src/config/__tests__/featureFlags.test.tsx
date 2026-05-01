import { describe, it, expect } from "vitest";
import { MESSAGING_ENABLED, DOCUMENTS_ENABLED, NOTES_ENABLED } from "@/config/featureFlags";

/**
 * Pilot dark-launch — pinning the three flag values at compile time.
 *
 * The flags live in src/config/featureFlags.ts and gate route
 * registration, nav entries, in-page CTAs, and notification
 * fan-out for the messenger / documents / notes features. For the
 * 90-day pilot all three MUST be false; this test fails the build
 * if anyone flips one prematurely.
 *
 * To re-enable a feature at pilot end:
 *   1. Edit src/config/featureFlags.ts and flip the relevant flag.
 *   2. Update this test (delete the assertion for the now-true flag,
 *      or change the expectation) so the test stays a tripwire for
 *      the OTHER flags that should remain false.
 *   3. Verify routes/nav/CTAs reappear in the UI and notification
 *      fan-out resumes.
 */

describe("pilot dark-launch feature flags", () => {
  it("MESSAGING_ENABLED is false during the pilot", () => {
    expect(MESSAGING_ENABLED).toBe(false);
  });

  it("DOCUMENTS_ENABLED is false during the pilot", () => {
    expect(DOCUMENTS_ENABLED).toBe(false);
  });

  it("NOTES_ENABLED is false during the pilot", () => {
    expect(NOTES_ENABLED).toBe(false);
  });
});
