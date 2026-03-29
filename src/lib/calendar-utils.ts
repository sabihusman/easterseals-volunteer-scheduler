// iCal export utility
export function generateICS(shift: {
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

  if (shift.time_type === "morning") { dtStart = `${date}T080000`; dtEnd = `${date}T120000`; }
  else if (shift.time_type === "afternoon") { dtStart = `${date}T120000`; dtEnd = `${date}T170000`; }
  else if (shift.time_type === "custom" && shift.start_time && shift.end_time) {
    dtStart = `${date}T${shift.start_time.replace(/:/g, "").slice(0, 6)}`;
    dtEnd = `${date}T${shift.end_time.replace(/:/g, "").slice(0, 6)}`;
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Easterseals//Volunteer Scheduler//EN",
    "BEGIN:VEVENT",
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${shift.title}`,
    `DESCRIPTION:Department: ${shift.departments?.name || "N/A"}`,
    `LOCATION:${shift.departments?.name || ""}`,
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

  if (shift.time_type === "morning") { startTime = "080000"; endTime = "120000"; }
  else if (shift.time_type === "afternoon") { startTime = "120000"; endTime = "170000"; }
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

// CSV export utility
export function downloadCSV(data: Record<string, any>[], filename: string) {
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

export function timeLabel(s: { time_type: string; start_time?: string | null; end_time?: string | null }): string {
  if (s.time_type === "custom" && s.start_time && s.end_time) return `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}`;
  return s.time_type.charAt(0).toUpperCase() + s.time_type.slice(1).replace("_", " ");
}
