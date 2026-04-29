import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Avatars live in a private `avatars` bucket; <img> tags can't carry
 * the Authorization JWT header, so we resolve the storage path to a
 * time-limited signed URL on render.
 *
 * Storage convention: `profiles.avatar_url` holds the bucket-relative
 * PATH (e.g. `aaaa-bbbb-cccc/avatar.jpg`), not a fully-qualified URL.
 * The migration to the `avatars` bucket coincided with this column's
 * semantic flip — there was no prior valid data because the previous
 * upload destination (`volunteer-documents`) had been RLS-denying
 * every avatar write since the bucket was created.
 *
 * Tolerance: legacy values that happen to contain a full URL
 * (starting with `http`) are passed through unchanged. Any future
 * data migration would set them to paths.
 */

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/** Derive a renderable URL from whatever is stored in profiles.avatar_url. */
export function useAvatarUrl(stored: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!stored) {
      setResolved(null);
      return;
    }

    // Pre-migration legacy: if any row somehow stored a full URL,
    // pass it through. (No live data takes this path today; included
    // for safety.)
    if (stored.startsWith("http://") || stored.startsWith("https://")) {
      setResolved(stored);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .storage
        .from("avatars")
        .createSignedUrl(stored, SIGNED_URL_TTL_SECONDS);
      if (cancelled) return;
      if (error || !data) {
        // Don't break the render — fall back to no avatar (the
        // initials fallback in <Avatar> kicks in). The most common
        // failure here is a stale `avatar_url` after the file was
        // removed; logging surfaces it without a destructive toast.
        console.warn("avatar signed-url resolve failed:", error);
        setResolved(null);
        return;
      }
      setResolved(data.signedUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [stored]);

  return resolved;
}
