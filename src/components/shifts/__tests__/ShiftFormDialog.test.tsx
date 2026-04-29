import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Tier 3 test for ShiftFormDialog.
 *
 * Validates: validation-kind branch coverage (missing / invalid_range /
 * not_assigned / long_shift_needs_confirm), create vs edit semantics,
 * and edit-mode form pre-population.
 *
 * DatePicker + TimePicker are stubbed as plain inputs — same precedent
 * as AvatarUploadField in Tier 2. The test's purpose is form-validation
 * + save semantics, not Radix Popover behavior in those shared widgets.
 */

const insertMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();
const toastMock = vi.fn();
const onSavedMock = vi.fn();
const onOpenChangeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
      update: (...args: unknown[]) => {
        updateMock(...args);
        return { eq: (...eqArgs: unknown[]) => eqMock(...eqArgs) };
      },
    }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Stubs for the shared/ children — see file header comment.
vi.mock("@/components/shared/DatePicker", () => ({
  DatePicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="date-picker" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/shared/TimePicker", () => ({
  TimePicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="time-picker" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { ShiftFormDialog } from "@/components/shifts/ShiftFormDialog";
import type { Department, Shift } from "@/hooks/useShiftsList";

const departments: Department[] = [
  { id: "dept-1", name: "Camp Sunnyside" },
  { id: "dept-2", name: "Adult Day" },
];

beforeEach(() => {
  insertMock.mockReset();
  updateMock.mockReset();
  eqMock.mockReset();
  toastMock.mockReset();
  onSavedMock.mockReset();
  onOpenChangeMock.mockReset();
  // Default success.
  insertMock.mockResolvedValue({ error: null });
  eqMock.mockResolvedValue({ error: null });
});

interface RenderOptions {
  editingShift?: Shift | null;
  role?: string | null;
  open?: boolean;
}

function renderDialog(opts: RenderOptions = {}) {
  render(
    <ShiftFormDialog
      open={opts.open ?? true}
      onOpenChange={onOpenChangeMock}
      editingShift={opts.editingShift ?? null}
      departments={departments}
      userId="user-coord-1"
      role={opts.role ?? "admin"}
      onSaved={onSavedMock}
    />
  );
}

function getDialogScope() {
  return within(screen.getByRole("dialog"));
}

function fillTitle(title: string) {
  fireEvent.change(getDialogScope().getByPlaceholderText(/morning grounds keeping/i), {
    target: { value: title },
  });
}

function fillDate(date: string) {
  fireEvent.change(screen.getByTestId("date-picker"), { target: { value: date } });
}

function fillTimes(start: string, end: string) {
  const pickers = screen.getAllByTestId("time-picker");
  fireEvent.change(pickers[0], { target: { value: start } });
  fireEvent.change(pickers[1], { target: { value: end } });
}

async function selectDepartment(deptId: string) {
  // Radix Select needs keyboard nav in jsdom (same pattern as AddUserDialog).
  const dialog = screen.getByRole("dialog");
  const trigger = within(dialog).getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("option", { name: new RegExp(departments.find((d) => d.id === deptId)!.name, "i") });
  fireEvent.keyDown(option, { key: "Enter" });
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: /create shift|update shift/i }));
}

describe("ShiftFormDialog", () => {
  it("toasts 'Missing or invalid fields' and skips supabase when required fields are empty", () => {
    renderDialog();
    clickSave();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/missing or invalid fields/i),
      variant: "destructive",
    }));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("toasts 'Invalid time range' when end time is before start time", async () => {
    renderDialog();
    fillTitle("Test Shift");
    await selectDepartment("dept-1");
    fillDate("2026-06-15");
    fillTimes("17:00:00", "09:00:00");
    clickSave();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/invalid time range/i),
      variant: "destructive",
    }));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("toasts 'Not assigned' when a coordinator edits a shift whose department isn't in their assigned list", () => {
    // Real-world path: a shift exists in dept-2; the coordinator was
    // unassigned from dept-2 but still has the edit dialog open. The form
    // pre-populates from editingShift, so form.department_id = "dept-2"
    // even though departments=[dept-1]. validateShiftForm catches this.
    const stale: Shift = {
      id: "shift-stale",
      title: "Stale Edit",
      department_id: "dept-2", // not in coordinator's assigned list below
      shift_date: "2026-06-15",
      time_type: "custom",
      start_time: "09:00:00",
      end_time: "12:00:00",
      total_slots: 1,
      status: "open",
      coordinator_note: null,
    };
    render(
      <ShiftFormDialog
        open={true}
        onOpenChange={onOpenChangeMock}
        editingShift={stale}
        departments={[{ id: "dept-1", name: "Camp Sunnyside" }]}
        userId="user-coord-1"
        role="coordinator"
        onSaved={onSavedMock}
      />
    );
    clickSave();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/not assigned/i),
      variant: "destructive",
    }));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("on long shift (>12h), confirms via window.confirm; cancel skips insert; accept proceeds", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderDialog();
    fillTitle("Long Shift");
    await selectDepartment("dept-1");
    fillDate("2026-06-15");
    fillTimes("06:00:00", "23:00:00"); // 17h
    // Branch 1: user cancels
    confirmSpy.mockReturnValueOnce(false);
    clickSave();
    expect(insertMock).not.toHaveBeenCalled();

    // Branch 2: user accepts
    confirmSpy.mockReturnValueOnce(true);
    clickSave();
    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledTimes(1);
    });
    confirmSpy.mockRestore();
  });

  it("on valid create, calls insert with payload + created_by + success toast + onSaved + onOpenChange(false)", async () => {
    renderDialog();
    fillTitle("Morning Grounds");
    await selectDepartment("dept-1");
    fillDate("2026-06-15");
    fillTimes("09:00:00", "12:00:00");
    clickSave();

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Morning Grounds",
        department_id: "dept-1",
        shift_date: "2026-06-15",
        start_time: "09:00:00",
        end_time: "12:00:00",
        created_by: "user-coord-1",
      }));
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringMatching(/shift created/i),
      }));
      expect(onOpenChangeMock).toHaveBeenCalledWith(false);
      expect(onSavedMock).toHaveBeenCalled();
    });
  });

  it("on valid edit, calls update().eq() (no created_by) and shows 'Shift updated' toast", async () => {
    const editing: Shift = {
      id: "shift-existing",
      title: "Edit Me",
      department_id: "dept-1",
      shift_date: "2026-06-15",
      time_type: "custom",
      start_time: "09:00:00",
      end_time: "12:00:00",
      total_slots: 4,
      status: "open",
      coordinator_note: null,
    };
    renderDialog({ editingShift: editing });
    // Form is pre-populated; just click save.
    clickSave();

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Edit Me",
        department_id: "dept-1",
      }));
      // The update payload should NOT include created_by — that's a create-only field.
      expect(updateMock.mock.calls[0][0]).not.toHaveProperty("created_by");
      expect(eqMock).toHaveBeenCalledWith("id", "shift-existing");
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringMatching(/shift updated/i),
      }));
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("on supabase error, shows 'Error' toast and keeps the dialog open (no onSaved)", async () => {
    insertMock.mockResolvedValue({ error: { message: "RLS denied" } });
    renderDialog();
    fillTitle("New Shift");
    await selectDepartment("dept-1");
    fillDate("2026-06-15");
    fillTimes("09:00:00", "12:00:00");
    clickSave();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error",
        description: "RLS denied",
        variant: "destructive",
      }));
    });
    expect(onOpenChangeMock).not.toHaveBeenCalledWith(false);
    expect(onSavedMock).not.toHaveBeenCalled();
  });

  it("opening in edit mode pre-populates the form fields from editingShift", () => {
    const editing: Shift = {
      id: "shift-existing",
      title: "Pre-Populated Title",
      department_id: "dept-2",
      shift_date: "2026-07-04",
      time_type: "custom",
      start_time: "13:00:00",
      end_time: "16:00:00",
      total_slots: 7,
      status: "open",
      coordinator_note: "Bring sunscreen",
    };
    renderDialog({ editingShift: editing });
    // Title input.
    expect((screen.getByPlaceholderText(/morning grounds keeping/i) as HTMLInputElement).value).toBe("Pre-Populated Title");
    // Date and times via the stubs.
    expect((screen.getByTestId("date-picker") as HTMLInputElement).value).toBe("2026-07-04");
    const pickers = screen.getAllByTestId("time-picker") as HTMLInputElement[];
    expect(pickers[0].value).toBe("13:00:00");
    expect(pickers[1].value).toBe("16:00:00");
    // Total slots.
    expect((screen.getByDisplayValue(7) as HTMLInputElement).value).toBe("7");
    // Coordinator note.
    expect((screen.getByPlaceholderText(/optional note visible/i) as HTMLTextAreaElement).value).toBe("Bring sunscreen");
  });
});
