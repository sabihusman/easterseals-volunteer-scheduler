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
