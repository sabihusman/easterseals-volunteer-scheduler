import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Self-service account deletion endpoint.
 *
 * Companion to the existing `delete-user` function (admin deletes
 * other users). The two are deliberately separate: each has one
 * flow, one set of invariants, one test matrix. Branching the
 * existing `delete-user` to also handle self-delete would have
 * required conditional role gates that mean opposite things in the
 * two paths — issue #178 root-caused exactly that confusion.
 *
 * Invariants:
 *
 *   1. Caller MUST equal target. The userId in the request body (if
 *      provided) MUST match the JWT's sub claim. Any mismatch is 403.
 *      This rules out a volunteer using this endpoint to delete a
 *      different user — that would be an admin operation and belongs
 *      on the admin endpoint.
 *
 *   2. Admin role is DISALLOWED. An admin self-deleting could brick
 *      the org if they're the only admin. The other admins still
 *      have access via `delete-user`, so admin-on-admin removal
 *      remains possible — just not self-service.
 *
 * On success: invokes `auth.admin.deleteUser(callerId)`. The cascade
 * graph (April 23 audit migration `20260423000002_profile_fk_cascade_audit.sql`)
 * handles the data fan-out:
 *
 *   - CASCADE: notifications, conversation_participants,
 *     dept_coordinators, dept_restrictions (volunteer side),
 *     mfa_backup_codes, parental_consents, shift_invitations
 *     (volunteer side), volunteer_documents, volunteer_private_notes,
 *     confirmation_reminders.
 *
 *   - SET NULL: shifts.created_by, shift_bookings.volunteer_id,
 *     attendance_disputes.*, admin_action_log.*, messages.sender_id,
 *     shift_notes.author_id, shift_attachments.uploader_id,
 *     events.created_by, event_registrations.volunteer_id, etc.
 *     (audit/historical data preserved with anonymized FK).
 *
 *   Hours: hours columns live on `shift_bookings` (final_hours,
 *   volunteer_reported_hours, coordinator_reported_hours). The
 *   SET NULL on shift_bookings.volunteer_id IS the hours-retention
 *   mechanism — bookings persist as orphan-volunteer rows with hours
 *   intact for coordinator reporting.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization header" }, 401);
    }

    // Use anon-key client with caller's JWT to identify the caller.
    // Service role for the delete itself (auth.admin.deleteUser).
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userResult, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !userResult?.user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    const callerId = userResult.user.id;

    // Optional body parameter: if a target_user_id is passed, it MUST
    // match the caller. Lets the frontend be explicit ("I am deleting
    // user X") without enabling cross-user deletion through this
    // endpoint. A missing body is treated as "delete the caller."
    let targetId: string = callerId;
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      try {
        const body = await req.json();
        if (body && typeof body === "object" && "target_user_id" in body) {
          const requested = (body as { target_user_id: unknown }).target_user_id;
          if (typeof requested !== "string") {
            return jsonResponse(
              { error: "target_user_id must be a string when provided" },
              400,
            );
          }
          targetId = requested;
        }
      } catch {
        // Empty/invalid body — treat as "delete caller".
      }
    }

    if (targetId !== callerId) {
      // Only path that hits this: caller passed someone else's id.
      // Surface a generic 403 — no need to disclose whether the
      // target exists.
      return jsonResponse(
        { error: "You can only delete your own account through this endpoint." },
        403,
      );
    }

    // Look up role. Admins are disallowed from self-deleting via
    // this endpoint regardless of how many admins exist; the
    // existing `delete-user` admin-on-admin path is also blocked
    // (intentionally — admin deletion is a manual SQL/Supabase-
    // dashboard operation today). If we ever want admin self-
    // delete, the precondition is "another admin exists" and that
    // belongs on a separate endpoint with its own audit log.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();

    if (profileErr || !profile) {
      console.error("delete-self: profile lookup failed", profileErr);
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    if (profile.role === "admin") {
      return jsonResponse(
        {
          error:
            "Admins cannot self-delete. Another admin must remove this account.",
        },
        403,
      );
    }

    // Proceed with the delete. The cascade graph handles the rest.
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(
      callerId,
    );

    if (deleteErr) {
      // Log server-side; do not leak Supabase admin-API error
      // messages to the client (could include schema/state hints).
      console.error("delete-self: auth.admin.deleteUser failed", {
        callerId,
        error: deleteErr.message,
      });
      return jsonResponse(
        { error: "Could not delete account. Please contact support." },
        500,
      );
    }

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("delete-self: unexpected error", message);
    return jsonResponse({ error: "Could not delete account. Please contact support." }, 500);
  }
});
