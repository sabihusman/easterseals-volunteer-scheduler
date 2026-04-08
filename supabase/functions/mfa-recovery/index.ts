// =============================================
// mfa-recovery edge function
//
// Self-service MFA recovery for users who lost their authenticator but
// still have a backup code. Validates the backup code via the
// mfa_consume_backup_code RPC (which marks the code used). On success,
// uses the service role to unenroll the user's TOTP factor so they can
// log in normally and re-enroll a fresh factor.
//
// This function MUST be called from an authenticated session that's
// already passed email/password (so the user is at AAL1 with a valid
// JWT). The MFA challenge gate prevents AAL2 protected routes, but
// AAL1 endpoints (like calling this function) work fine.
//
// Body: { code: string }
// Returns: { success: true } on valid code, { success: false } otherwise
// =============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Identify the calling user from their JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!code) {
      return new Response(JSON.stringify({ success: false, error: "Code is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate the backup code via the user's own session so the RPC's
    // auth.uid() resolves to them. The RPC marks the code used atomically.
    const { data: ok, error: rpcError } = await userClient.rpc("mfa_consume_backup_code", {
      p_code: code,
    });
    if (rpcError) {
      console.error("mfa_consume_backup_code error:", rpcError);
      return new Response(JSON.stringify({ success: false, error: "Invalid code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ok) {
      return new Response(JSON.stringify({ success: false, error: "Invalid code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Code is valid and now consumed. Unenroll all TOTP factors for the
    // user so they can sign in fresh and re-enroll.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}/factors`, {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    });
    if (!listRes.ok) {
      console.error("Failed to list factors:", await listRes.text());
      return new Response(
        JSON.stringify({ success: false, error: "Could not list factors" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { factors } = await listRes.json();

    let removed = 0;
    for (const factor of factors || []) {
      const delRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${user.id}/factors/${factor.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
        }
      );
      if (delRes.ok) removed++;
    }

    return new Response(
      JSON.stringify({ success: true, factors_removed: removed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("mfa-recovery error:", e);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
