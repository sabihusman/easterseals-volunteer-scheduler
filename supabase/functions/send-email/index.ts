const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BRAND_COLOR = "#006B3E";
const APP_NAME = "Easterseals Iowa Volunteer Scheduler";
const APP_URL = "https://easterseals-volunteer-scheduler.vercel.app";

const SANDBOX_MODE = true; // Set to false once domain is verified at resend.com/domains
const SANDBOX_EMAIL = "sabih.usman@gmail.com";

function brandedHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="background:${BRAND_COLOR};padding:24px 32px;">
<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${APP_NAME}</h1>
</td></tr>
<tr><td style="padding:32px;">
${bodyContent}
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
<p style="margin:0;font-size:12px;color:#6b7280;text-align:center;">
${APP_NAME} · Easterseals Iowa<br>
<a href="${APP_URL}" data-resend-track="false" style="color:${BRAND_COLOR};">Open App</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(text: string, href: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
<a href="${href}" data-resend-track="false" style="display:inline-block;padding:12px 28px;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">${text}</a>
</td></tr></table>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">${text}</p>`;
}

function h2(text: string): string {
  return `<h2 style="margin:0 0 16px;font-size:18px;color:#111827;font-weight:600;">${text}</h2>`;
}

function detail(label: string, value: string): string {
  return `<p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>${label}:</strong> ${value}</p>`;
}

function bigNumber(number: string, label: string): string {
  return `<div style="text-align:center;padding:24px 0;">
<div style="font-size:48px;font-weight:700;color:${BRAND_COLOR};">${number}</div>
<div style="font-size:14px;color:#6b7280;margin-top:4px;">${label}</div>
</div>`;
}

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  type?: string;
  // Template data fields
  shiftTitle?: string;
  shiftDate?: string;
  shiftTime?: string;
  department?: string;
  selectedSlots?: string;
  volunteerName?: string;
  coordinatorName?: string;
  bookingId?: string;
  totalHours?: number;
  resetLink?: string;
  daysSinceShift?: number;
  cancellationTime?: string;
}

function buildTemplateEmail(payload: EmailPayload): { subject: string; html: string } | null {
  const { type, shiftTitle, shiftDate, shiftTime, department, selectedSlots, volunteerName, coordinatorName, bookingId, totalHours, resetLink, daysSinceShift, cancellationTime } = payload;

  switch (type) {
    case "shift_booked":
      return {
        subject: `Shift Confirmed — ${shiftTitle}`,
        html: brandedHtml(
          h2("Your shift is confirmed! ✅") +
          p(`You're all set for <strong>${shiftTitle}</strong>.`) +
          detail("Date", shiftDate || "") +
          detail("Time", shiftTime || "") +
          detail("Department", department || "") +
          (selectedSlots ? detail("Selected Slots", selectedSlots) : "") +
          button("View My Shifts", `${APP_URL}/dashboard`)
        ),
      };

    case "shift_reminder":
      return {
        subject: `Reminder: Your shift tomorrow — ${shiftTitle}`,
        html: brandedHtml(
          h2("Shift Reminder 📋") +
          p(`This is a friendly reminder that you have a shift coming up.`) +
          detail("Shift", shiftTitle || "") +
          detail("Date", shiftDate || "") +
          detail("Time", shiftTime || "") +
          detail("Department", department || "") +
          p("Please arrive on time and check in with your coordinator.") +
          button("Open App", `${APP_URL}/dashboard`)
        ),
      };

    case "self_confirmation_reminder":
      return {
        subject: `Please confirm your attendance — ${shiftTitle}`,
        html: brandedHtml(
          h2("Please Confirm Your Attendance") +
          p(`Thank you for volunteering! Your shift <strong>${shiftTitle}</strong> on ${shiftDate} has ended.`) +
          p("Please take a moment to confirm your attendance, log your hours, and rate your experience.") +
          button("Confirm Attendance", `${APP_URL}/my-shifts/confirm/${bookingId}`)
        ),
      };

    case "waitlist_offer":
      return {
        subject: `A spot just opened: ${shiftTitle}`,
        html: brandedHtml(
          h2("A Waitlist Spot Just Opened! 🎉") +
          p(`A spot has opened for <strong>${shiftTitle}</strong> on ${shiftDate}. You're next on the waitlist.`) +
          p("You have <strong>2 hours</strong> to accept or decline. After that the offer moves to the next volunteer on the waitlist.") +
          button("Review & Respond", `${APP_URL}/dashboard`)
        ),
      };

    case "waitlist_offer_expired":
      return {
        subject: `Waitlist offer expired — ${shiftTitle || "shift"}`,
        html: brandedHtml(
          h2("Waitlist Offer Expired") +
          p("You didn't respond to the waitlist offer within 2 hours, so the spot has moved to the next volunteer in line.") +
          p("You can still browse other shifts and book a new one.") +
          button("Browse Shifts", `${APP_URL}/shifts`)
        ),
      };

    case "unactioned_shift_reminder":
      return {
        subject: `Action needed: confirm your shift — ${shiftTitle}`,
        html: brandedHtml(
          h2("Please Check In and Confirm Your Shift") +
          p(`Your shift <strong>${shiftTitle}</strong> on ${shiftDate} has ended, but we don't yet have a check-in or confirmation from you.`) +
          p("Volunteer hours are only counted once you check in and submit your shift confirmation. If no action is taken within a week of the shift, it will be removed from your history and may affect your consistency score.") +
          button("Confirm Shift Now", `${APP_URL}/my-shifts/confirm/${bookingId}`)
        ),
      };

    case "unactioned_shift_coord_reminder":
      return {
        subject: `Volunteer not confirmed — ${shiftTitle}`,
        html: brandedHtml(
          h2("Volunteer Has Not Confirmed Shift") +
          p(`${volunteerName || "A volunteer"} has not checked in or confirmed their shift:`) +
          detail("Shift", shiftTitle || "") +
          detail("Date", shiftDate || "") +
          detail("Volunteer", volunteerName || "") +
          p("More than 48 hours have passed since the shift ended. Please follow up with them or mark the shift as complete from the unactioned shifts list.") +
          button("Review Unactioned Shifts", `${APP_URL}/admin/unactioned-shifts`)
        ),
      };

    case "coordinator_confirmation_reminder":
      return {
        subject: `Action Required: Confirm attendance for ${shiftTitle}`,
        html: brandedHtml(
          h2("Action Required: Confirm Volunteer Attendance") +
          p(`A volunteer's attendance needs your confirmation.`) +
          detail("Volunteer", volunteerName || "") +
          detail("Shift", shiftTitle || "") +
          detail("Date", shiftDate || "") +
          detail("Time", shiftTime || "") +
          button("Confirm Now", `${APP_URL}/coordinator`)
        ),
      };

    case "admin_escalation":
      return {
        subject: `Escalation: Unconfirmed shift — ${shiftTitle}`,
        html: brandedHtml(
          h2("⚠️ Escalation: Unconfirmed Shift") +
          p(`A shift has gone ${daysSinceShift || 3} days without attendance confirmation.`) +
          detail("Volunteer", volunteerName || "") +
          detail("Shift", shiftTitle || "") +
          detail("Date", shiftDate || "") +
          detail("Coordinator", coordinatorName || "") +
          button("View in Admin Dashboard", `${APP_URL}/admin`)
        ),
      };

    case "late_cancellation":
      return {
        subject: `⚠️ Late Cancellation — ${shiftTitle} today`,
        html: brandedHtml(
          h2("⚠️ Late Cancellation Alert") +
          p(`A volunteer has cancelled less than 12 hours before the shift.`) +
          detail("Volunteer", volunteerName || "") +
          detail("Shift", shiftTitle || "") +
          detail("Time", shiftTime || "") +
          detail("Cancelled at", cancellationTime || "") +
          p("You may want to find a replacement or adjust staffing.") +
          button("View Department Shifts", `${APP_URL}/coordinator`)
        ),
      };

    case "waitlist_notification":
      return {
        subject: `A spot opened up — ${shiftTitle}`,
        html: brandedHtml(
          h2("A Spot Just Opened Up! 🎉") +
          p(`Great news! A spot has opened for <strong>${shiftTitle}</strong>.`) +
          detail("Date", shiftDate || "") +
          detail("Time", shiftTime || "") +
          detail("Department", department || "") +
          p("This spot may fill quickly — book now to secure it.") +
          button("Book Now", `${APP_URL}/shifts`)
        ),
      };

    case "hours_milestone":
      return {
        subject: `🎉 You've reached ${totalHours} volunteer hours!`,
        html: brandedHtml(
          h2("Congratulations! 🎉") +
          bigNumber(String(totalHours || 0), "Total Volunteer Hours") +
          p("Your dedication makes a real difference in our community. Thank you for your incredible service!") +
          button("View Shift History", `${APP_URL}/history`)
        ),
      };

    case "registration_welcome":
      return {
        subject: "Welcome to Easterseals Iowa Volunteer Portal",
        html: brandedHtml(
          h2("Welcome to Easterseals Iowa! 👋") +
          p(`Hi ${volunteerName || "there"},`) +
          p("Thank you for registering as a volunteer. Here's how to get started:") +
          `<table cellpadding="0" cellspacing="0" style="margin:16px 0 24px;">
            <tr><td style="padding:8px 0;font-size:14px;color:#374151;"><strong>1.</strong> Wait for an admin to activate your account</td></tr>
            <tr><td style="padding:8px 0;font-size:14px;color:#374151;"><strong>2.</strong> Browse and book available shifts</td></tr>
            <tr><td style="padding:8px 0;font-size:14px;color:#374151;"><strong>3.</strong> Show up, check in, and make a difference!</td></tr>
          </table>` +
          button("Browse Shifts", `${APP_URL}/shifts`)
        ),
      };

    case "password_reset":
      return {
        subject: "Reset your password — Easterseals Iowa",
        html: brandedHtml(
          h2("Reset Your Password") +
          p("We received a request to reset your password. Click the button below to set a new password.") +
          button("Reset Password", resetLink || `${APP_URL}/reset-password`) +
          p("This link expires in 1 hour. If you didn't request this, you can safely ignore this email.") +
          `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">For security, never share this link with anyone.</p>`
        ),
      };

    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: EmailPayload = await req.json();
    const { to } = payload;

    if (!to) {
      return new Response(JSON.stringify({ error: "Recipient email (to) is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try template-based email first, fall back to raw html
    const templateEmail = buildTemplateEmail(payload);
    const subject = templateEmail?.subject || payload.subject;
    const html = templateEmail?.html || payload.html;

    if (!subject || !html) {
      return new Response(JSON.stringify({ error: "Subject and html are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sandbox mode: redirect all emails to test address
    const actualTo = SANDBOX_MODE ? SANDBOX_EMAIL : to;
    const actualSubject = SANDBOX_MODE ? `[TEST] ${subject}` : subject;
    if (SANDBOX_MODE) {
      console.log(`Sandbox mode: redirecting email for ${to} to ${SANDBOX_EMAIL}`);
    }

    // NOTE: Resend wraps every email link with us-east-1.resend-clicks.com
    // for click tracking. That wrapper occasionally fails with
    // ERR_QUIC_PROTOCOL_ERROR and the volunteer sees a "This site can't be
    // reached" page. Add data-resend-track="false" on anchors to opt out at
    // the link level, and request the account-level tracking be disabled in
    // the Resend dashboard (Settings \u2192 Tracking).
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${APP_NAME} <onboarding@resend.dev>`,
        to: [actualTo],
        subject: actualSubject,
        html,
        // Best-effort: newer Resend API versions accept these; older ones ignore
        tags: [{ name: "click_tracking", value: "off" }],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      // Log error but return 200 so callers never break
      console.error("Resend API error:", data);
      return new Response(JSON.stringify({ success: false, warning: "Email sending failed silently" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: data.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Log error but return 200 so callers never break
    console.error("send-email error:", e);
    return new Response(JSON.stringify({ success: false, warning: "Email sending failed silently" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
