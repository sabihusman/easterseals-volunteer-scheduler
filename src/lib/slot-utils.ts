/**
 * Format a time string like "08:00:00" or "08:00" to "8:00 AM"
 */
export function formatSlotTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Format a slot range like "8:00 AM – 10:00 AM"
 */
export function formatSlotRange(slotStart: string, slotEnd: string): string {
  return `${formatSlotTime(slotStart)} – ${formatSlotTime(slotEnd)}`;
}

/**
 * Calculate hours for a slot (difference between start and end)
 */
export function slotHours(slotStart: string, slotEnd: string): number {
  const [sh, sm] = slotStart.split(":").map(Number);
  const [eh, em] = slotEnd.split(":").map(Number);
  return (eh * 60 + em - sh * 60 - sm) / 60;
}

/**
 * Preview how many 2-hour slots a shift will generate
 */
export function previewSlotCount(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const totalMinutes = eh * 60 + em - (sh * 60 + sm);
  if (totalMinutes <= 0) return 0;
  return Math.ceil(totalMinutes / 120);
}

/**
 * Preview the actual 2-hour slot boundaries for a shift.
 * Returns array of {start, end} time strings in HH:MM format.
 * Last slot gets the remainder if not evenly divisible by 2h.
 */
export function previewSlots(
  startTime: string,
  endTime: string
): Array<{ start: string; end: string }> {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin <= startMin) return [];

  const slots: Array<{ start: string; end: string }> = [];
  let cursor = startMin;
  while (cursor < endMin) {
    const slotEnd = Math.min(cursor + 120, endMin);
    const sH = Math.floor(cursor / 60);
    const sM = cursor % 60;
    const eH = Math.floor(slotEnd / 60);
    const eM = slotEnd % 60;
    slots.push({
      start: `${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}`,
      end: `${String(eH).padStart(2, "0")}:${String(eM).padStart(2, "0")}`,
    });
    cursor = slotEnd;
  }
  return slots;
}
