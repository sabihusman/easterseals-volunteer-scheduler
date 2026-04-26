import type { Department } from "@/hooks/useShiftsList";

/** Coordinator notes max length, enforced at form input. */
export const NOTE_MAX = 500;

export interface ShiftForm {
  title: string;
  department_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  total_slots: number;
  coordinator_note: string;
}

export const EMPTY_SHIFT_FORM: ShiftForm = {
  title: "",
  department_id: "",
  shift_date: "",
  start_time: "",
  end_time: "",
  total_slots: 1,
  coordinator_note: "",
};

/** True iff the shift starts more than 1 hour from now (note still editable). */
export function canEditNote(shiftDate: string, startTime: string): boolean {
  const shiftStart = new Date(`${shiftDate}T${startTime}`);
  const cutoff = new Date(shiftStart.getTime() - 60 * 60 * 1000);
  return new Date() < cutoff;
}

export interface DurationInfo {
  text: string;
  minutes: number;
  warn: boolean;
}

/**
 * Live duration calc for the shift form. Returns null when either time is
 * blank, otherwise a structured result the UI can display + style:
 *
 *   - minutes <= 0   → "End must be after start", warn=true, destructive style
 *   - minutes > 8h   → warn=true (likely AM/PM mistake), amber style
 *   - otherwise      → neutral style
 */
export function computeDurationInfo(startTime: string, endTime: string): DurationInfo | null {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return null;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const diffMin = endMin - startMin;
  if (diffMin <= 0) return { text: "End must be after start", minutes: diffMin, warn: true };
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return { text: parts.join(" ") || "0m", minutes: diffMin, warn: diffMin > 8 * 60 };
}

/**
 * Discriminated-union validation result. The page UI layer translates each
 * non-ok kind into toast strings + (for `long_shift_needs_confirm`) a
 * window.confirm prompt — those concerns stay out of the lib.
 */
export type ShiftValidation =
  | { ok: true }
  | { ok: false; kind: "missing"; missing: string[] }
  | { ok: false; kind: "not_assigned" }
  | { ok: false; kind: "invalid_range" }
  | { ok: false; kind: "long_shift_needs_confirm"; durationMin: number };

/**
 * Validate the shift form for the create/edit dialog. The role + departments
 * inputs gate the "coordinator must save into an assigned department" rule;
 * pass `role: "admin"` to skip that check.
 */
export function validateShiftForm(form: ShiftForm, departments: Department[], role: string | null): ShiftValidation {
  const missing: string[] = [];
  if (!form.title) missing.push("Shift Title");
  if (!form.department_id) missing.push("Department");
  if (!form.shift_date) missing.push("Date");
  if (!form.start_time) missing.push("Start Time (make sure AM/PM is set)");
  if (!form.end_time) missing.push("End Time (make sure AM/PM is set)");
  if (missing.length > 0) return { ok: false, kind: "missing", missing };

  if (
    role === "coordinator" &&
    form.department_id &&
    !departments.some((d) => d.id === form.department_id)
  ) {
    return { ok: false, kind: "not_assigned" };
  }

  // Lexical comparison works because times are HH:MM:SS sortable.
  if (form.start_time >= form.end_time) {
    return { ok: false, kind: "invalid_range" };
  }

  // >12h sanity check — almost always an AM/PM mistake. Page asks user to
  // confirm via window.confirm; lib just reports the condition.
  const [sh, sm] = form.start_time.split(":").map(Number);
  const [eh, em] = form.end_time.split(":").map(Number);
  const durationMin = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMin > 12 * 60) {
    return { ok: false, kind: "long_shift_needs_confirm", durationMin };
  }

  return { ok: true };
}
