import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const record = payload.record || payload;

    // Only process new notifications
    if (!record || !record.user_id || !record.type) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get the user's email, phone, and notification preferences
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name, phone, notif_email, notif_sms, notif_shift_reminders, notif_new_messages, notif_milestone, notif_document_expiry, notif_booking_changes")
      .eq("id", record.user_id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ skipped: true, reason: "profile not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build email payload based on notification type
    const emailPayload: Record<string, unknown> = {
      to: profile.email,
      type: record.type,
      volunteerName: profile.full_name,
    };

    // Extract shift details from the notification message if available
    if (record.link) {
      emailPayload.bookingId = record.link.split("/").pop();
    }

    // For types that map directly to email templates
    const typeMap: Record<string, boolean> = {
      self_confirmation_reminder: true,
      late_cancellation: true,
      shift_reminder: true,
      shift_reminder_auto: true,
      coordinator_confirmation_reminder: true,
      admin_escalation: true,
      waitlist_notification: true,
      hours_milestone: true,
      new_message: true,
      document_expired: true,
      document_expiry_warning: true,
      bg_check_status_change: true,
      booking_confirmed: true,
      booking_cancelled: true,
    };

    if (!typeMap[record.type]) {
      // Not a type we send notifications for via webhook
      return new Response(JSON.stringify({ skipped: true, reason: "type not mapped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Type-specific preference check
    const typePrefs: Record<string, string> = {
      shift_reminder: "notif_shift_reminders",
      shift_reminder_auto: "notif_shift_reminders",
      self_confirmation_reminder: "notif_shift_reminders",
      new_message: "notif_new_messages",
      hours_milestone: "notif_milestone",
      document_expired: "notif_document_expiry",
      document_expiry_warning: "notif_document_expiry",
      booking_confirmed: "notif_booking_changes",
      booking_cancelled: "notif_booking_changes",
      late_cancellation: "notif_booking_changes",
      waitlist_notification: "notif_booking_changes",
    };
    const prefCol = typePrefs[record.type];
    if (prefCol && (profile as any)[prefCol] === false) {
      return new Response(JSON.stringify({ skipped: true, reason: "type preference disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse shift details from message
    emailPayload.shiftTitle = record.title || "";
    emailPayload.subject = record.title;

    // ── Send Email ──
    if (profile.notif_email) {
      const { error } = await supabase.functions.invoke("send-email", {
        body: emailPayload,
      });
      if (error) {
        console.error("Failed to send email via webhook:", error);
      }
    }

    // ── Send SMS ──
    if (profile.notif_sms && profile.phone) {
      // Build a concise SMS message from notification
      let smsBody = `[Easterseals Iowa] ${record.title || "Notification"}: ${(record.message || "").slice(0, 140)}`;

      // For auto shift reminders, include location if available
      if (record.type === "shift_reminder_auto" && record.data?.location) {
        smsBody = `[Easterseals Iowa] ${record.title || "Shift Reminder"} at ${record.data.location}: ${(record.message || "").slice(0, 120)}`;
      }

      const { error: smsError } = await supabase.functions.invoke("send-sms", {
        body: { to: profile.phone, body: smsBody },
      });
      if (smsError) {
        console.error("Failed to send SMS via webhook:", smsError);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("notification-webhook error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
