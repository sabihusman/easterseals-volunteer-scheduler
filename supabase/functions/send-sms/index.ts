const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SmsPayload {
  to: string;       // Recipient phone number (E.164 format: +1XXXXXXXXXX)
  body: string;     // SMS message body (max 1600 chars)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      console.error("Missing Twilio environment variables");
      return new Response(JSON.stringify({ error: "Twilio not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: SmsPayload = await req.json();
    const { to, body } = payload;

    if (!to || !body) {
      return new Response(JSON.stringify({ error: "to and body are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize phone number to E.164 format
    let phone = to.replace(/[^\d+]/g, "");
    if (!phone.startsWith("+")) {
      phone = phone.startsWith("1") ? `+${phone}` : `+1${phone}`;
    }

    // Twilio REST API - send SMS
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const authHeader = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const formData = new URLSearchParams({
      To: phone,
      From: TWILIO_PHONE_NUMBER,
      Body: body.slice(0, 1600), // Twilio max
    });

    const res = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authHeader}`,
      },
      body: formData.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Twilio API error:", data);
      return new Response(JSON.stringify({ success: false, warning: "SMS sending failed", detail: data.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`SMS sent to ${phone}: SID ${data.sid}`);
    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-sms error:", e);
    return new Response(JSON.stringify({ success: false, warning: "SMS sending failed silently" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
