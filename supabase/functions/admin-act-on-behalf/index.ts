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

    // Verify the caller is an admin using their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Check admin role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await adminClient.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return new Response(JSON.stringify({ error: "Forbidden: admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { action, volunteerId, payload } = await req.json();
    if (!action || !volunteerId) return new Response(JSON.stringify({ error: "action and volunteerId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let result: any;

    switch (action) {
      case "book_shift": {
        const { error, data } = await adminClient.from("shift_bookings").insert({
          shift_id: payload.shiftId,
          volunteer_id: volunteerId,
          booking_status: "confirmed",
        }).select().single();
        if (error) throw error;
        result = data;
        break;
      }
      case "cancel_booking": {
        const { error, data } = await adminClient.from("shift_bookings").update({
          booking_status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", payload.bookingId).eq("volunteer_id", volunteerId).select().single();
        if (error) throw error;
        result = data;
        break;
      }
      case "submit_confirmation": {
        const { error, data } = await adminClient.from("volunteer_shift_reports").insert({
          booking_id: payload.bookingId,
          volunteer_id: volunteerId,
          self_confirm_status: "attended",
          self_reported_hours: payload.hours,
          submitted_at: new Date().toISOString(),
        }).select().single();
        if (error) throw error;
        // Also update shift_bookings
        await adminClient.from("shift_bookings").update({
          confirmation_status: "confirmed",
          volunteer_reported_hours: payload.hours,
          final_hours: payload.hours,
          hours_source: "admin_override",
          confirmed_at: new Date().toISOString(),
        }).eq("id", payload.bookingId);
        result = data;
        break;
      }
      case "update_profile": {
        const allowedFields = ["full_name", "phone", "emergency_contact_name", "emergency_contact_phone"];
        const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
        for (const field of allowedFields) {
          if (payload[field] !== undefined) updateData[field] = payload[field];
        }
        const { error, data } = await adminClient.from("profiles").update(updateData).eq("id", volunteerId).select().single();
        if (error) throw error;
        result = data;
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Log the action
    await adminClient.from("admin_action_log").insert({
      admin_id: user.id,
      volunteer_id: volunteerId,
      action,
      payload,
    });

    return new Response(JSON.stringify({ success: true, data: result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("admin-act-on-behalf error:", e);
    return new Response(JSON.stringify({ success: false, error: e.message || "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
