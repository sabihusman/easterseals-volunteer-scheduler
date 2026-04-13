const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BRAND_COLOR = "#006B3E";
const APP_NAME = "Easterseals Iowa Volunteer Scheduler";
const APP_URL = "https://easterseals-volunteer-scheduler.vercel.app";

// Sandbox mode is opt-in via env var — previously this was hard-coded
// to true with a personal email as the redirect target, which silently
// hijacked every transactional email in production. Set EMAIL_SANDBOX
// to "true" and EMAIL_SANDBOX_REDIRECT to a test inbox during local
// testing only; in prod, leave both unset so emails go to real users.
const SANDBOX_MODE = Deno.env.get("EMAIL_SANDBOX") === "true";
const SANDBOX_EMAIL = Deno.env.get("EMAIL_SANDBOX_REDIRECT") || "";

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
<a href="${APP_URL}" style="color:${BRAND_COLOR};">Open App</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(text: string, href: string): string {
  // Include the raw URL as plain text fallback below the button so users
  // can always copy/paste if their email client mangles the link.
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
<a href="${href}" style="display:inline-block;padding:12px 28px;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">${text}</a>
</td></tr></table>
<p style="margin:-8px 0 24px;font-size:12px;line-height:1.5;color:#6b7280;">If the button above doesn't open, copy and paste this link into your browser:<br><span style="word-break:break-all;color:#374151;font-family:monospace;">${href}</span></p>`;
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

    case "shift_cancelled":
      // Sent when an admin or coordinator cancels an entire shift that
      // a volunteer was booked on.
      return {
        subject: `Shift Cancelled — ${shiftTitle || "your shift"}`,
        html: brandedHtml(
          h2("Your Shift Was Cancelled") +
          p(`Unfortunately, <strong>${shiftTitle || "your shift"}</strong> has been cancelled by the coordinator.`) +
          (shiftDate ? detail("Date", shiftDate) : "") +
          (shiftTime ? detail("Time", shiftTime) : "") +
          (department ? detail("Department", department) : "") +
          p("We're sorry for the inconvenience. Please browse other available shifts to book a new one.") +
          button("Browse Shifts", `${APP_URL}/shifts`)
        ),
      };

    case "booking_cancelled":
      // Confirmation email to a volunteer who just cancelled their
      // own booking (from the dashboard / shift list).
      return {
        subject: `Booking cancelled — ${shiftTitle || "your shift"}`,
        html: brandedHtml(
          h2("Booking Cancelled") +
          p(`Your booking for <strong>${shiftTitle || "this shift"}</strong> has been cancelled.`) +
          (shiftDate ? detail("Date", shiftDate) : "") +
          (shiftTime ? detail("Time", shiftTime) : "") +
          (department ? detail("Department", department) : "") +
          p("If this was a mistake, you can rebook the shift from the shifts page — it may still be available.") +
          button("Browse Shifts", `${APP_URL}/shifts`)
        ),
      };

    case "new_message":
      // In-app messaging notification.
      return {
        subject: `New message — ${APP_NAME}`,
        html: brandedHtml(
          h2("You have a new message") +
          p(`${volunteerName || coordinatorName || "Someone"} just sent you a message in the volunteer portal.`) +
          button("Open Messages", `${APP_URL}/messages`)
        ),
      };

    case "shift_invitation":
      return {
        subject: `You've been invited to: ${shiftTitle || "a shift"}`,
        html: brandedHtml(
          h2("You've Been Invited to a Shift") +
          p(`An admin has invited you to volunteer for <strong>${shiftTitle || "a shift"}</strong>.`) +
          (shiftDate ? detail("Date", shiftDate) : "") +
          (shiftTime ? detail("Time", shiftTime) : "") +
          (department ? detail("Department", department) : "") +
          p("Log in to your dashboard to accept or decline this invitation. The invitation expires when the shift starts.") +
          button("View Invitation", `${APP_URL}/dashboard`)
        ),
      };

    default:
      // Log the missing type so adding new notification types without
      // a corresponding template surfaces quickly instead of silently
      // dropping outbound email.
      console.warn(`send-email: no template for notification type "${type}"`);
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================================
    // Provider selection (feature flag)
    //   EMAIL_PROVIDER=mailersend (default) -> MailerSend (no click wrapping)
    //   EMAIL_PROVIDER=resend                -> Resend (legacy, has click wrapping)
    // ============================================================
    const EMAIL_PROVIDER = (Deno.env.get("EMAIL_PROVIDER") || "mailersend").toLowerCase();
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const MAILERSEND_API_KEY = Deno.env.get("MAILERSEND_API_KEY");
    const MAILERSEND_FROM_EMAIL =
      Deno.env.get("MAILERSEND_FROM_EMAIL") || "noreply@test-pzkmgq70q2vl059v.mlsender.net";

    if (EMAIL_PROVIDER === "resend" && !RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (EMAIL_PROVIDER === "mailersend" && !MAILERSEND_API_KEY) {
      return new Response(JSON.stringify({ error: "MAILERSEND_API_KEY not configured" }), {
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

    // Sandbox mode (opt-in via EMAIL_SANDBOX env var): redirect every
    // outgoing email to the configured test inbox. If EMAIL_SANDBOX is
    // set but EMAIL_SANDBOX_REDIRECT is empty, fall through and send to
    // the real recipient (the misconfiguration shouldn't silently drop
    // mail).
    const sandboxActive = SANDBOX_MODE && SANDBOX_EMAIL;
    const actualTo = sandboxActive ? SANDBOX_EMAIL : to;
    const actualSubject = sandboxActive ? `[TEST] ${subject}` : subject;
    if (sandboxActive) {
      console.log(`Sandbox mode: redirecting email for ${to} to ${SANDBOX_EMAIL}`);
    }

    let providerResponseId: string | undefined;
    let providerError: unknown = null;

    if (EMAIL_PROVIDER === "mailersend") {
      // MailerSend API: https://developers.mailersend.com/api/v1/email.html
      // Free tier does NOT wrap links with a tracking proxy.
      const msRes = await fetch("https://api.mailersend.com/v1/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          Authorization: `Bearer ${MAILERSEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: { email: MAILERSEND_FROM_EMAIL, name: APP_NAME },
          to: [{ email: actualTo }],
          subject: actualSubject,
          html,
          // Disable both tracking modes explicitly so they can never bite us
          // even if MailerSend defaults change.
          settings: {
            track_clicks: false,
            track_opens: false,
            track_content: false,
          },
        }),
      });
      // MailerSend returns 202 Accepted with empty body on success.
      // Message ID is in the X-Message-Id response header.
      if (!msRes.ok) {
        let errBody: unknown = null;
        try { errBody = await msRes.json(); } catch { errBody = await msRes.text(); }
        providerError = { status: msRes.status, body: errBody };
        console.error("MailerSend API error:", providerError);
      } else {
        providerResponseId = msRes.headers.get("X-Message-Id") || undefined;
      }
    } else {
      // ===== Resend (legacy path) =====
      // NOTE: Resend wraps every email link with us-east-1.resend-clicks.com
      // for click tracking. Free-tier accounts cannot disable it.
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
          tags: [{ name: "click_tracking", value: "off" }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        providerError = data;
        console.error("Resend API error:", data);
      } else {
        providerResponseId = data?.id;
      }
    }

    if (providerError) {
      return new Response(
        JSON.stringify({
          success: false,
          warning: "Email sending failed silently",
          provider: EMAIL_PROVIDER,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: providerResponseId, provider: EMAIL_PROVIDER }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    // Log error but return 200 so callers never break
    console.error("send-email error:", e);
    return new Response(JSON.stringify({ success: false, warning: "Email sending failed silently" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
