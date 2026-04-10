import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth: accept EITHER an authenticated admin OR the service_role key ──
    // When both admins are locked out of MFA, the only recovery path is
    // calling this function with the service_role key directly. In normal
    // operation, an authenticated admin calls it from the UI.
    const authHeader = req.headers.get("Authorization");
    const bearerToken = authHeader?.replace("Bearer ", "");
    const isServiceRole = bearerToken === serviceRoleKey;

    if (!isServiceRole) {
      // Normal path: verify caller is an authenticated admin
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: adminProfile } = await adminClient.from("profiles").select("role").eq("id", user.id).single();
      if (!adminProfile || adminProfile.role !== "admin") {
        return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Parse params: accept userId OR email ──
    const body = await req.json();
    let targetUserId: string | null = body.userId || null;
    const targetEmail: string | null = body.email || null;

    // If email provided but no userId, look up the user
    if (!targetUserId && targetEmail) {
      const { data } = await adminClient.auth.admin.listUsers();
      const found = data?.users?.find((u) => u.email === targetEmail);
      if (found) targetUserId = found.id;
    }

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "userId or email is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── List and delete MFA factors ──
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${targetUserId}/factors`, {
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      console.error("Failed to list MFA factors:", err);
      return new Response(JSON.stringify({ success: false, error: "Failed to list MFA factors" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const factors = await listRes.json();
    let deletedCount = 0;

    if (Array.isArray(factors) && factors.length > 0) {
      for (const factor of factors) {
        const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${targetUserId}/factors/${factor.id}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "apikey": serviceRoleKey,
          },
        });
        if (delRes.ok) deletedCount++;
        else console.error(`Failed to delete factor ${factor.id}:`, await delRes.text());
      }
    }

    // ── Clear app-level MFA fields ──
    await adminClient.from("profiles").update({
      mfa_enabled: false,
      mfa_secret: null,
      mfa_backup_codes: null,
    }).eq("id", targetUserId);

    // ── Audit log via RPC ──
    // Resolve email for logging if we only had userId
    let logEmail = targetEmail;
    if (!logEmail) {
      const { data: u } = await adminClient.auth.admin.getUserById(targetUserId);
      logEmail = u?.user?.email || targetUserId;
    }

    try {
      await adminClient.rpc("log_mfa_reset", { target_email: logEmail });
    } catch (e) {
      // Don't fail the reset if audit logging fails
      console.error("Failed to log MFA reset:", e);
    }

    // ── Also log to admin_action_log if caller is authenticated admin ──
    if (!isServiceRole) {
      const userClient2 = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader! } },
      });
      const { data: { user: callerUser } } = await userClient2.auth.getUser();
      if (callerUser) {
        await adminClient.from("admin_action_log").insert({
          admin_id: callerUser.id,
          volunteer_id: targetUserId,
          action: "reset_mfa",
          payload: { factors_deleted: deletedCount },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: deletedCount > 0
        ? `Removed ${deletedCount} MFA factor(s). User can now log in without 2FA and should re-enroll immediately.`
        : "No MFA factors found for this user.",
      factors_deleted: deletedCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("admin-reset-mfa error:", e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
