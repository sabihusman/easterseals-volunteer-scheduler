import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Not authorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userId } = await req.json();
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: targetProfile } = await supabaseAdmin
      .from("profiles")
      .select("role, full_name")
      .eq("id", userId)
      .single();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (targetProfile.role === "admin") {
      return new Response(
        JSON.stringify({ error: "Cannot delete another admin account" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Coordinator delete: transfer responsibilities first ──
    if (targetProfile.role === "coordinator") {
      const { data: transferResult, error: rpcError } = await supabaseAdmin
        .rpc("transfer_coordinator_and_delete", {
          p_coordinator_id: userId,
          p_admin_id: user.id,
        });

      if (rpcError) {
        return new Response(
          JSON.stringify({
            error: `Transfer failed: ${rpcError.message}`,
            step: "rpc_call",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!transferResult?.success) {
        const stepLabels: Record<string, string> = {
          validation: "Validation",
          department_transfer: "Department ownership transfer",
          shift_transfer: "Shift ownership transfer",
          reassign_references: "Reassigning coordinator references",
          notification_cleanup: "Notification cleanup",
          delete_profile: "Profile deletion",
        };
        const failedStep = stepLabels[transferResult?.step] || transferResult?.step || "Unknown step";
        return new Response(
          JSON.stringify({
            error: `${failedStep} failed: ${transferResult?.error || "Unknown error"}`,
            step: transferResult?.step,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Profile is already deleted by the RPC. Now remove from auth.users.
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (authError) {
        // Profile is gone but auth record remains — log but still report success
        // since the coordinator data has been fully transferred.
        console.error("Auth user delete failed after profile transfer:", authError.message);
      }

      return new Response(
        JSON.stringify({
          success: true,
          transferred: true,
          message: `${targetProfile.full_name || "Coordinator"}'s account has been deleted. Their departments and shifts have been transferred to you.`,
          departments_transferred: transferResult.departments_transferred,
          departments_removed: transferResult.departments_removed,
          shifts_transferred: transferResult.shifts_transferred,
          notifications_deleted: transferResult.notifications_deleted,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Volunteer (or other role) delete: simple path ──
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        transferred: false,
        message: `${targetProfile.full_name || "User"}'s account has been deleted.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
