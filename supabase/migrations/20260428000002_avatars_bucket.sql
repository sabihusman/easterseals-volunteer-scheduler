-- Audit 2026-04-28: profile photo upload (`AvatarUploadField`) was
-- routing to `volunteer-documents` at path `avatars/{userId}/avatar.{ext}`
-- and being silently RLS-denied. The volunteer-documents bucket's
-- INSERT policy requires `(storage.foldername(name))[1] = auth.uid()::text`
-- AND an active `document_requests` row for the volunteer — neither
-- condition holds for an avatar upload. Phase 1 of the audit
-- confirmed: zero existing avatar files in that bucket (RLS has been
-- denying day one).
--
-- This migration creates a dedicated `avatars` bucket with RLS that
-- matches the brief:
--
--   * NOT public — unauthenticated reads must fail. Frontend uses
--     `createSignedUrl` because <img> tags can't carry the
--     Authorization JWT header, and getPublicUrl() doesn't work on
--     non-public buckets.
--   * INSERT/UPDATE/DELETE: scoped per-user. The first folder
--     segment of the object name MUST be the caller's auth.uid().
--     `(storage.foldername(name))[1]::uuid = auth.uid()` casts the
--     path segment to UUID — a malformed first segment (or a missing
--     one) raises a cast error and the predicate evaluates to false,
--     denying the write.
--   * SELECT: any authenticated user can read any avatar. Avatars
--     surface on coordinator dashboards and (future) messaging
--     UIs; locking SELECT to the owner would block those.
--
-- Path pattern: `{user_id}/avatar.{ext}` (a single canonical file
-- per user; re-uploads use upsert=true and overwrite cleanly).
--
-- Out of scope (per brief): cleanup of `volunteer-documents/avatars/*`
-- (none exist — RLS blocked from day one), image
-- resizing/optimization, avatar in messaging UI.

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', false)
ON CONFLICT (id) DO NOTHING;

-- ── RLS policies on storage.objects, scoped to the avatars bucket ──

-- INSERT: users upload only to their own folder.
CREATE POLICY "Users INSERT own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1]::uuid = auth.uid()
  );

-- UPDATE: same scoping. Both USING (which row is visible to
-- update) and WITH CHECK (post-update predicate) so a user can't
-- rename / move someone else's avatar onto their path either.
CREATE POLICY "Users UPDATE own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1]::uuid = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1]::uuid = auth.uid()
  );

-- DELETE: same scoping. Avatar removal flows through this.
CREATE POLICY "Users DELETE own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1]::uuid = auth.uid()
  );

-- SELECT: any authenticated user reads any avatar. The TO clause
-- already restricts to authenticated; the bucket_id check scopes
-- the policy to this bucket only. Anonymous role has no policy
-- granting SELECT, so unauthenticated reads fail closed.
CREATE POLICY "Authenticated SELECT any avatar"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
  );
