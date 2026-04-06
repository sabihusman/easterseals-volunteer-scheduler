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

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: adminProfile } = await adminClient.from("profiles").select("role").eq("id", user.id).single();
    if (!adminProfile || adminProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the Admin API to list and delete MFA factors for the target user
    // Supabase Admin API: DELETE /auth/v1/admin/users/{user_id}/factors/{factor_id}
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/factors`, {
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
        const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/factors/${factor.id}`, {
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

    // Log the action
    await adminClient.from("admin_action_log").insert({
      admin_id: user.id,
      volunteer_id: userId,
      action: "reset_mfa",
      payload: { factors_deleted: deletedCount },
    });

    return new Response(JSON.stringify({
      success: true,
      message: deletedCount > 0
        ? `Removed ${deletedCount} MFA factor(s). User can now log in without 2FA.`
        : "No MFA factors found for this user.",
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
