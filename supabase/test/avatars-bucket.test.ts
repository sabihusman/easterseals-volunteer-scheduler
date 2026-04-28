import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  signInAs,
  adminBypassClient,
  anonClient,
  getHarnessUsers,
} from "./clients";

/**
 * RLS coverage for the dedicated `avatars` bucket introduced in
 * `20260428000002_avatars_bucket.sql`. The bug being fixed: avatar
 * uploads were silently RLS-denied because the previous code routed
 * to `volunteer-documents` whose policies require both a UID-prefixed
 * path AND an active `document_requests` row.
 *
 * Properties pinned by these tests:
 *
 *   1. Authenticated user can write/update/delete to {their_uid}/...
 *   2. Authenticated user CANNOT write/update/delete to a different
 *      user's folder (the SECURITY-DEFINER bypass guard for INSERT
 *      lives inside the policy's WITH CHECK clause; UPDATE/DELETE
 *      use USING for the visibility predicate).
 *   3. Any authenticated user CAN read any avatar (via createSignedUrl,
 *      which requires SELECT). This is per the brief — avatars surface
 *      on coordinator dashboards and other multi-user views.
 *   4. Anonymous role CANNOT read avatars. The bucket is not public;
 *      the SELECT policy is gated to `TO authenticated`.
 *
 * Cleanup: every blob written by the test is removed in afterAll via
 * the service-role client.
 */

const BUCKET = "avatars";

function pathFor(uid: string): string {
  return `${uid}/avatar.png`;
}

const writtenPaths: string[] = [];

async function stubUpload(client: Awaited<ReturnType<typeof signInAs>>, path: string) {
  return client.storage
    .from(BUCKET)
    .upload(path, new Blob(["stub"], { type: "image/png" }), { upsert: true });
}

beforeAll(async () => {
  // Ensure no leftover blobs from a prior failed run.
  const admin = adminBypassClient();
  const users = getHarnessUsers();
  const allPaths = [users.volunteer.id, users.volunteer2.id, users.coordinator.id, users.admin.id]
    .map(pathFor);
  await admin.storage.from(BUCKET).remove(allPaths);
});

afterAll(async () => {
  if (writtenPaths.length === 0) return;
  const admin = adminBypassClient();
  await admin.storage.from(BUCKET).remove(writtenPaths);
});

describe("avatars bucket RLS", () => {
  it("authenticated user CAN INSERT to their own UID folder", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const path = pathFor(users.volunteer.id);

    const { error } = await stubUpload(client, path);
    expect(error).toBeNull();
    writtenPaths.push(path);
  });

  it("authenticated user CANNOT INSERT to another user's UID folder", async () => {
    const users = getHarnessUsers();
    const volunteer = await signInAs("volunteer");

    // volunteer attempts to write to volunteer2's path
    const foreignPath = pathFor(users.volunteer2.id);
    const { error } = await stubUpload(volunteer, foreignPath);

    expect(error).not.toBeNull();
    // Storage API surfaces RLS denial as a 403/400 with a "violates
    // row-level security policy" message — exact wording depends on
    // the storage-api version, so just assert non-null.
  });

  it("authenticated user CAN UPDATE (re-upload upsert) their own avatar", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const path = pathFor(users.volunteer.id);

    // First upload (or replace) — succeeds.
    const { error: first } = await stubUpload(client, path);
    expect(first).toBeNull();

    // Second upload to the same path with upsert — succeeds because
    // RLS UPDATE policy admits the same UID-prefix.
    const { error: second } = await stubUpload(client, path);
    expect(second).toBeNull();

    if (!writtenPaths.includes(path)) writtenPaths.push(path);
  });

  it("authenticated user CAN DELETE their own avatar", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const path = pathFor(users.volunteer.id);

    // Stage a blob first so delete has something to remove.
    await stubUpload(client, path);

    const { data, error } = await client.storage.from(BUCKET).remove([path]);
    expect(error).toBeNull();
    // remove() returns the deleted file metadata array.
    expect(data).toBeTruthy();
  });

  it("authenticated user CANNOT DELETE another user's avatar", async () => {
    const users = getHarnessUsers();

    // Stage volunteer2's avatar via service role (so the file exists
    // even though volunteer2 hasn't logged in to upload it).
    const admin = adminBypassClient();
    const targetPath = pathFor(users.volunteer2.id);
    await admin.storage
      .from(BUCKET)
      .upload(targetPath, new Blob(["stub"], { type: "image/png" }), { upsert: true });
    writtenPaths.push(targetPath);

    // volunteer attempts to delete volunteer2's path. Storage RLS
    // UPDATE/DELETE on a row the caller can't see returns "no rows"
    // (silent in some storage-api versions) — verify the file is
    // STILL present after the attempt.
    const volunteer = await signInAs("volunteer");
    await volunteer.storage.from(BUCKET).remove([targetPath]);

    // Confirm the file survived — service-role can list it.
    const { data: listing } = await admin.storage
      .from(BUCKET)
      .list(users.volunteer2.id);
    const stillThere = (listing || []).some((f) => f.name === "avatar.png");
    expect(stillThere).toBe(true);
  });

  it("any authenticated user can read any avatar (createSignedUrl works for non-owner)", async () => {
    const users = getHarnessUsers();

    // Ensure target avatar exists (from earlier test) — use admin to
    // avoid coupling to test order.
    const admin = adminBypassClient();
    const targetPath = pathFor(users.volunteer.id);
    await admin.storage
      .from(BUCKET)
      .upload(targetPath, new Blob(["stub"], { type: "image/png" }), { upsert: true });
    if (!writtenPaths.includes(targetPath)) writtenPaths.push(targetPath);

    // Coordinator (a DIFFERENT user) requests a signed URL for the
    // volunteer's avatar. Per the brief, any authenticated user can
    // SELECT — this must work.
    const coordinator = await signInAs("coordinator");
    const { data, error } = await coordinator.storage
      .from(BUCKET)
      .createSignedUrl(targetPath, 60);

    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  it("anonymous role CANNOT read avatars (bucket is not public)", async () => {
    const users = getHarnessUsers();
    const admin = adminBypassClient();
    const targetPath = pathFor(users.volunteer.id);
    await admin.storage
      .from(BUCKET)
      .upload(targetPath, new Blob(["stub"], { type: "image/png" }), { upsert: true });
    if (!writtenPaths.includes(targetPath)) writtenPaths.push(targetPath);

    const anon = anonClient();
    const { data, error } = await anon.storage
      .from(BUCKET)
      .createSignedUrl(targetPath, 60);

    // SELECT policy is `TO authenticated`; anon role has no policy
    // granting SELECT. Either an error is returned OR the data is
    // null. (Storage-api version variance — same shape as the
    // document-request-system test for the rejected-doc case.)
    expect(error !== null || data === null).toBe(true);
  });
});
