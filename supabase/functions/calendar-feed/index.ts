import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  const emptyIcs = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Easterseals Iowa//Volunteer Scheduler//EN\r\nEND:VCALENDAR";
  const icsHeaders = { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };

  if (!token) return new Response(emptyIcs, { status: 401, headers: icsHeaders });

  // Use service role to look up the long-lived calendar_token (not a JWT)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Find the user by their calendar_token (UUID, never expires)
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("calendar_token", token)
    .single();

  if (profileError || !profile) return new Response(emptyIcs, { status: 401, headers: icsHeaders });

  const volunteerId = profile.id;

  // Fetch upcoming confirmed bookings
  const { data: bookings } = await supabase
    .from("shift_bookings")
    .select("id, shifts(id, title, shift_date, start_time, end_time, coordinator_note, departments(name, locations(name, address, timezone)))")
    .eq("volunteer_id", volunteerId)
    .eq("booking_status", "confirmed")
    .gte("shifts.shift_date", new Date().toISOString().split("T")[0]);

  if (!bookings || bookings.length === 0) return new Response(emptyIcs, { headers: icsHeaders });

  const events = bookings.filter((b: any) => b.shifts).map((b: any) => {
    const s = b.shifts;
    const dept = s.departments;
    const loc = dept?.locations;
    const date = s.shift_date.replace(/-/g, "");
    const start = (s.start_time || "09:00:00").replace(/:/g, "").slice(0, 6);
    const end = (s.end_time || "17:00:00").replace(/:/g, "").slice(0, 6);
    const location = loc?.address || loc?.name || "";
    const tz = loc?.timezone || "America/Chicago";
    const description = [dept?.name, s.coordinator_note, "Managed via Easterseals Iowa Volunteer Scheduler"].filter(Boolean).join("\\n");

    return [
      "BEGIN:VEVENT",
      `UID:${s.id}@easterseals-volunteer-scheduler`,
      `DTSTART;TZID=${tz}:${date}T${start}`,
      `DTEND;TZID=${tz}:${date}T${end}`,
      `SUMMARY:${s.title}`,
      `LOCATION:${location}`,
      `DESCRIPTION:${description}`,
      "END:VEVENT",
    ].join("\r\n");
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Easterseals Iowa//Volunteer Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Easterseals Iowa Shifts",
    "X-WR-TIMEZONE:America/Chicago",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, { headers: icsHeaders });
});
