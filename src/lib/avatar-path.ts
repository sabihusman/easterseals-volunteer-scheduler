/**
 * Canonical avatar-path builder. The `avatars` bucket's RLS policy
 * requires the first folder segment of the object name to equal the
 * caller's auth.uid(); this helper enforces that shape on the client
 * side so a typo in one upload site can't generate a path that gets
 * silently RLS-denied.
 *
 * Returns `{userId}/avatar.{ext}`. The `userId` is NOT validated here
 * — the auth boundary at write time (RLS) is the actual gate. The
 * extension is normalized to lowercase and stripped of any leading
 * dot or whitespace.
 */
export function buildAvatarPath(userId: string, ext: string): string {
  const cleanExt = (ext || "png")
    .replace(/^\./, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  // Default keeps the path valid even if a caller passes "" or a
  // string of only special characters.
  const safeExt = cleanExt || "png";
  return `${userId}/avatar.${safeExt}`;
}
