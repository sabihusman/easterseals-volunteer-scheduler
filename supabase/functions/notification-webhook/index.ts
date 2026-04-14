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
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: {
        headers: { Authorization: `Bearer ${serviceRoleKey}` },
      },
    });

    // Get the user's email, phone, and notification preferences
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, full_name, phone, emergency_contact_phone, notif_email, notif_sms, notif_shift_reminders, notif_new_messages, notif_milestone, notif_document_expiry, notif_booking_changes")
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
      shift_cancelled: true,
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
      shift_invitation: true,
      booking_changed: true,
      self_no_show: true,
      unactioned_shift_reminder: true,
      unactioned_shift_coord_reminder: true,
      waitlist_offer: true,
      waitlist_offer_expired: true,
    };

    if (!typeMap[record.type]) {
      // Not a type we send notifications for via webhook
      return new Response(JSON.stringify({ skipped: true, reason: "type not mapped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Type-specific preference check. Every type in typeMap MUST have
    // a mapping here, otherwise the user's opt-out preference for that
    // category is silently ignored and the notification always sends.
    // Previously bg_check_status_change, shift_invitation, and
    // admin_escalation were missing from this map.
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
      booking_changed: "notif_booking_changes",
      self_no_show: "notif_booking_changes",
      late_cancellation: "notif_booking_changes",
      shift_cancelled: "notif_booking_changes",
      waitlist_notification: "notif_booking_changes",
      unactioned_shift_reminder: "notif_shift_reminders",
      unactioned_shift_coord_reminder: "notif_shift_reminders",
      waitlist_offer: "notif_booking_changes",
      waitlist_offer_expired: "notif_booking_changes",
      // Previously missing — sent regardless of user opt-out:
      bg_check_status_change: "notif_booking_changes",
      shift_invitation: "notif_shift_reminders",
      admin_escalation: "notif_shift_reminders",
      coordinator_confirmation_reminder: "notif_shift_reminders",
    };
    // Urgent waitlist offers (< 30 minutes acceptance window) bypass
    // ALL preference opt-outs and send via every channel. The volunteer
    // needs maximum chance of seeing the offer before it expires.
    const isUrgentWaitlistOffer =
      record.type === "waitlist_offer" &&
      record.data?.window_minutes != null &&
      Number(record.data.window_minutes) < 30;

    const prefCol = typePrefs[record.type];
    if (!isUrgentWaitlistOffer && prefCol && (profile as any)[prefCol] === false) {
      return new Response(JSON.stringify({ skipped: true, reason: "type preference disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse shift details from message
    emailPayload.shiftTitle = record.data?.shift_title || record.title || "";
    emailPayload.subject = record.title;
    if (record.data?.shift_date) emailPayload.shiftDate = record.data.shift_date;
    if (record.data?.booking_id) emailPayload.bookingId = record.data.booking_id;
    if (record.data?.volunteer_name) emailPayload.volunteerName = record.data.volunteer_name;

    // ── Send Email ──
    // Urgent waitlist offers send email regardless of notif_email pref.
    if (profile.notif_email || isUrgentWaitlistOffer) {
      const { error } = await supabase.functions.invoke("send-email", {
        body: emailPayload,
      });
      if (error) {
        console.error("Failed to send email via webhook:", error);
      }
    }

    // ── Send SMS ──
    // SMS delivery is gated by a global feature flag. The Twilio sending
    // number is currently not verified for our destination numbers, so
    // messages are accepted by Twilio's API but silently dropped at the
    // carrier. Set SMS_ENABLED=true in Supabase secrets to re-enable
    // once the Twilio number/recipients are verified.
    const smsEnabled = Deno.env.get("SMS_ENABLED") === "true";

    // Only send to the volunteer's own phone number. Previously this
    // fell back to emergency_contact_phone when profile.phone was null,
    // which was a privacy concern — the emergency contact (likely a
    // family member) would receive shift reminders and late-cancellation
    // alerts without any opt-in from them. Fail closed: if the
    // volunteer hasn't set a phone number, SMS is simply not sent.
    const smsTarget = profile.phone || null;
    // Urgent waitlist offers send SMS regardless of notif_sms pref.
    if (smsEnabled && (profile.notif_sms || isUrgentWaitlistOffer) && smsTarget) {
      // Build a concise SMS message from notification
      let smsBody = `[Easterseals Iowa] ${record.title || "Notification"}: ${(record.message || "").slice(0, 140)}`;

      // For auto shift reminders, include location if available
      if (record.type === "shift_reminder_auto" && record.data?.location) {
        smsBody = `[Easterseals Iowa] ${record.title || "Shift Reminder"} at ${record.data.location}: ${(record.message || "").slice(0, 120)}`;
      }

      const { error: smsError } = await supabase.functions.invoke("send-sms", {
        body: { to: smsTarget, body: smsBody },
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
