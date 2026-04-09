// iCal export utility
export function generateICS(shift: {
  id?: string;
  title: string;
  shift_date: string;
  start_time?: string | null;
  end_time?: string | null;
  time_type: string;
  departments?: { name: string } | null;
}): string {
  const date = shift.shift_date.replace(/-/g, "");
  let dtStart = `${date}T090000`;
  let dtEnd = `${date}T170000`;

  if (shift.time_type === "morning") { dtStart = `${date}T090000`; dtEnd = `${date}T120000`; }
  else if (shift.time_type === "afternoon") { dtStart = `${date}T130000`; dtEnd = `${date}T160000`; }
  else if (shift.time_type === "all_day") { dtStart = `${date}T090000`; dtEnd = `${date}T170000`; }
  else if (shift.time_type === "custom" && shift.start_time && shift.end_time) {
    dtStart = `${date}T${shift.start_time.replace(/:/g, "").slice(0, 6)}`;
    dtEnd = `${date}T${shift.end_time.replace(/:/g, "").slice(0, 6)}`;
  }

  // Stable UID — uses the shift ID if available, otherwise falls back to a
  // deterministic hash of date+title so re-imports overwrite instead of
  // duplicating. DTSTAMP is required by RFC 5545.
  const uidBase = shift.id || `${shift.shift_date}-${shift.title}`.replace(/[^a-zA-Z0-9-]/g, "_");
  const uid = `${uidBase}@easterseals-iowa-volunteer`;
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace(/Z$/, "Z");

  // Escape commas/semicolons/newlines per RFC 5545
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Easterseals//Volunteer Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=America/Chicago:${dtStart}`,
    `DTEND;TZID=America/Chicago:${dtEnd}`,
    `SUMMARY:${esc(shift.title)}`,
    `DESCRIPTION:${esc("Department: " + (shift.departments?.name || "N/A"))}`,
    `LOCATION:${esc(shift.departments?.name || "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadICS(shift: Parameters<typeof generateICS>[0]) {
  const ics = generateICS(shift);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${shift.title.replace(/[^a-zA-Z0-9]/g, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export function googleCalendarUrl(shift: Parameters<typeof generateICS>[0]): string {
  const date = shift.shift_date.replace(/-/g, "");
  let startTime = "090000";
  let endTime = "170000";

  if (shift.time_type === "morning") { startTime = "090000"; endTime = "120000"; }
  else if (shift.time_type === "afternoon") { startTime = "130000"; endTime = "160000"; }
  else if (shift.time_type === "all_day") { startTime = "090000"; endTime = "170000"; }
  else if (shift.time_type === "custom" && shift.start_time && shift.end_time) {
    startTime = shift.start_time.replace(/:/g, "").slice(0, 6);
    endTime = shift.end_time.replace(/:/g, "").slice(0, 6);
  }

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: shift.title,
    dates: `${date}T${startTime}/${date}T${endTime}`,
    details: `Department: ${shift.departments?.name || "N/A"}`,
    location: shift.departments?.name || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Parse a YYYY-MM-DD string as LOCAL midnight instead of UTC.
 * Using `new Date("2026-04-08")` parses as UTC midnight and then
 * displays in local time — which in any timezone west of UTC shows
 * the PREVIOUS calendar day. Appending T00:00:00 anchors to local.
 */
export function parseShiftDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date(NaN);
  return new Date(dateStr + "T00:00:00");
}

// CSV export utility
export function downloadCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) => headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const SHIFT_TIME_DEFAULTS: Record<string, { start: string; end: string; label: string }> = {
  morning: { start: "09:00", end: "12:00", label: "Morning" },
  afternoon: { start: "13:00", end: "16:00", label: "Afternoon" },
  all_day: { start: "09:00", end: "17:00", label: "All Day" },
};

function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function getShiftTimes(s: { time_type: string; start_time?: string | null; end_time?: string | null }): { start: string; end: string } {
  // Always prefer the actual start/end times when present, regardless
  // of time_type. A coordinator might select "Morning" as a category
  // but enter hours outside the 9-12 default (e.g. 2 PM – 3 PM).
  // Previously this only used actual times when time_type === "custom",
  // causing "Morning · 9:00 AM – 12:00 PM" to display when the real
  // hours were completely different.
  if (s.start_time && s.end_time) {
    return { start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) };
  }
  const defaults = SHIFT_TIME_DEFAULTS[s.time_type];
  if (defaults) return { start: defaults.start, end: defaults.end };
  return { start: "09:00", end: "17:00" };
}

export function timeLabel(s: { time_type: string; start_time?: string | null; end_time?: string | null }): string {
  const times = getShiftTimes(s);
  const defaults = SHIFT_TIME_DEFAULTS[s.time_type];
  // Show the preset label (Morning/Afternoon/All Day) only if the
  // actual times match the defaults. Otherwise show "Custom" to
  // avoid misleading labels like "Morning · 3:00 PM – 4:00 PM".
  const timesMatchDefaults = defaults && times.start === defaults.start && times.end === defaults.end;
  const label = timesMatchDefaults ? defaults.label : "Custom";
  return `${label} · ${formatTime12(times.start)} – ${formatTime12(times.end)}`;
}
