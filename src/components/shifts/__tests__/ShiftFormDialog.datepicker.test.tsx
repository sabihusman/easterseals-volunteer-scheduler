import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { format, addDays } from "date-fns";

/**
 * Companion test for ShiftFormDialog — exercises the REAL DatePicker
 * (Radix Popover + Calendar from react-day-picker) end-to-end.
 *
 * The sibling file `ShiftFormDialog.test.tsx` stubs DatePicker and
 * TimePicker as plain `<input data-testid>` elements to keep its
 * focus on form validation and save semantics. That stubbing is why
 * the bug fixed in PR #156 (Dialog/Popover modal-trap closing the
 * calendar without setting a date) wasn't caught — the existing
 * tests never wired up the Radix portal flow.
 *
 * This file complements it by mounting the real Calendar inside the
 * real Dialog and asserting the click-a-day flow lands the chosen
 * date in form state. NO stubs for DatePicker, Calendar, or Popover
 * — that's the whole point.
 */

const insertMock = vi.fn();
const eqMock = vi.fn();
const toastMock = vi.fn();
const onSavedMock = vi.fn();
const onOpenChangeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Time-picker is stubbed only because filling those fields isn't what
// we're testing here. Date-picker stays REAL.
vi.mock("@/components/shared/TimePicker", () => ({
  TimePicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="time-picker" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { ShiftFormDialog } from "@/components/shifts/ShiftFormDialog";
import type { Department } from "@/hooks/useShiftsList";

const departments: Department[] = [
  { id: "dept-1", name: "Camp Sunnyside" },
];

beforeEach(() => {
  insertMock.mockReset();
  eqMock.mockReset();
  toastMock.mockReset();
  onSavedMock.mockReset();
  onOpenChangeMock.mockReset();
  insertMock.mockResolvedValue({ error: null });
});

function renderDialog() {
  render(
    <ShiftFormDialog
      open={true}
      onOpenChange={onOpenChangeMock}
      editingShift={null}
      departments={departments}
      userId="user-coord-1"
      role="admin"
      onSaved={onSavedMock}
    />
  );
}

describe("ShiftFormDialog — DatePicker (real Radix calendar)", () => {
  it("clicking a day in the calendar lands the date in form state and lets the form save", async () => {
    renderDialog();

    // 1. Open the calendar popover by clicking the date trigger.
    //    The trigger button shows the placeholder when no date is set.
    const trigger = screen.getByRole("button", { name: /select a date/i });
    fireEvent.click(trigger);

    // 2. The calendar grid renders inside a Radix Portal — querying
    //    via screen (which searches document.body) finds it.
    //    react-day-picker exposes a grid with role="grid".
    const grid = await screen.findByRole("grid");
    expect(grid).toBeInTheDocument();

    // 3. Pick today as the target. Calendar opens to the current
    //    month, so today's day-of-month is always present in the
    //    visible grid; using today keeps the day-text we click and
    //    the formatted assertion against the trigger consistent
    //    without needing to navigate months.
    const target = new Date();
    const targetDayOfMonth = target.getDate().toString();
    const targetIsoDate = format(target, "yyyy-MM-dd");
    void addDays; // imported but not used in current selector strategy

    // react-day-picker 8.x renders day cells as <button name="day">
    // with the day-of-month as text content (no aria-label, so
    // role-based queries don't find them). Filter by `name="day"`
    // attribute + textContent match. Outside-month preview cells
    // are also rendered as `name="day"` buttons, but the in-month
    // cell appears first in DOM order.
    const dayButtons = Array.from(
      grid.querySelectorAll<HTMLButtonElement>('button[name="day"]')
    ).filter((btn) => btn.textContent?.trim() === targetDayOfMonth);
    expect(dayButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(dayButtons[0]);

    // 4. After click, the trigger button now shows the formatted date
    //    instead of the placeholder. This is the load-bearing
    //    assertion: it proves onSelect → onChange → setForm did fire.
    await waitFor(() => {
      // Trigger label changes from placeholder to "Month D, YYYY".
      const updatedTrigger = screen.getByRole("button", { name: new RegExp(format(target, "MMMM d, yyyy"), "i") });
      expect(updatedTrigger).toBeInTheDocument();
    });

    // 5. Fill the rest of the required form so the save flow can
    //    proceed: title, department (already pre-selectable), times.
    fireEvent.change(
      screen.getByPlaceholderText(/morning grounds keeping/i),
      { target: { value: "Test Shift" } }
    );

    // Department — same Radix Select keyboard pattern as the sibling
    // test file. Multiple elements have role="dialog" because Radix
    // Popover content also reports as a dialog; use the first match
    // (the main ShiftFormDialog).
    const dialog = screen.getAllByRole("dialog")[0];
    const deptTrigger = within(dialog).getByRole("combobox");
    fireEvent.keyDown(deptTrigger, { key: "Enter" });
    const deptOption = await screen.findByRole("option", { name: /camp sunnyside/i });
    fireEvent.keyDown(deptOption, { key: "Enter" });

    // Times — these are stubbed.
    const timePickers = screen.getAllByTestId("time-picker");
    fireEvent.change(timePickers[0], { target: { value: "09:00:00" } });
    fireEvent.change(timePickers[1], { target: { value: "12:00:00" } });

    // 6. Save. This will fire the validation path; if the date
    //    didn't make it into form state the toast would say
    //    "Missing or invalid fields" and insert would not be called.
    fireEvent.click(screen.getByRole("button", { name: /create shift/i }));

    // 7. Insert called with the chosen date as `shift_date`. This
    //    is the end-to-end proof that the date-picker click landed.
    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Test Shift",
          department_id: "dept-1",
          shift_date: targetIsoDate,
        })
      );
    });

    // 8. No "Missing or invalid fields" validation toast fired.
    const validationToast = toastMock.mock.calls.find(
      (c) => /missing or invalid fields/i.test((c[0] as { title?: string })?.title ?? "")
    );
    expect(validationToast).toBeUndefined();
  });
});
