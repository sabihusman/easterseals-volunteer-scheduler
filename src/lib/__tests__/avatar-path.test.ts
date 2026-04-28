import { describe, it, expect } from "vitest";
import { buildAvatarPath } from "@/lib/avatar-path";

const UID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("buildAvatarPath", () => {
  it("produces {userId}/avatar.{ext} for normal input", () => {
    expect(buildAvatarPath(UID, "jpg")).toBe(`${UID}/avatar.jpg`);
  });

  it("strips a leading dot from the extension", () => {
    expect(buildAvatarPath(UID, ".png")).toBe(`${UID}/avatar.png`);
  });

  it("lowercases the extension", () => {
    expect(buildAvatarPath(UID, "JPEG")).toBe(`${UID}/avatar.jpeg`);
  });

  it("falls back to png when extension is missing", () => {
    expect(buildAvatarPath(UID, "")).toBe(`${UID}/avatar.png`);
  });

  it("strips non-alphanumeric characters from the extension", () => {
    expect(buildAvatarPath(UID, "j p g")).toBe(`${UID}/avatar.jpg`);
    // Path-traversal attempts are stripped of slashes/dots and then
    // capped to 8 chars by the same length guard that protects against
    // overlong extensions. "../etc/passwd" → "etcpasswd" → "etcpassw".
    expect(buildAvatarPath(UID, "../etc/passwd")).toBe(`${UID}/avatar.etcpassw`);
  });

  it("caps the extension length so a malicious input can't blow up the path", () => {
    expect(buildAvatarPath(UID, "x".repeat(50))).toBe(`${UID}/avatar.xxxxxxxx`);
  });

  it("places the userId as the first folder segment so RLS matches it", () => {
    // The avatars bucket's RLS policy uses
    // `(storage.foldername(name))[1]::uuid = auth.uid()`. The first
    // folder segment is everything before the first slash. This
    // test pins that the helper puts the userId there — a regression
    // would break uploads silently with an RLS denial.
    const path = buildAvatarPath(UID, "jpg");
    const firstSegment = path.split("/")[0];
    expect(firstSegment).toBe(UID);
  });
});
