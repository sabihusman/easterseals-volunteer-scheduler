import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Issue #119: AdminDepartments create/edit dialog never worked because
 * `location_id` (NOT NULL in schema) had no field, and `min_age` (NOT NULL
 * with default 18) was sent as null when blank — both INSERTs and UPDATEs
 * with empty min_age were 500ing.
 *
 * Tests cover the three branches the fix touches:
 *   - validation: bail when no location selected
 *   - create: insert payload includes location_id; min_age omitted when blank
 *   - edit: update payload omits min_age when blank (not null)
 */

const fromMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => fromMock(...a),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import AdminDepartments from "@/pages/AdminDepartments";

const sampleDepts = [
  {
    id: "dept-1",
    name: "Camp Sunnyside",
    description: "Camp",
    requires_bg_check: false,
    min_age: 18,
    allows_groups: true,
    is_active: true,
    location_id: "loc-1",
  },
];
const sampleLocations = [
  { id: "loc-1", name: "Des Moines HQ" },
  { id: "loc-2", name: "Cedar Rapids" },
];

const insertMock = vi.fn();
const updateMock = vi.fn();
const eqUpdateMock = vi.fn();

function setupSupabase() {
  // Each .from(table) call returns a chainable builder that resolves to the
  // appropriate seeded data; insert/update/eq are spies we assert against.
  fromMock.mockImplementation((table: string) => {
    if (table === "departments") {
      return {
        select: () => ({
          order: () => Promise.resolve({ data: sampleDepts, error: null }),
        }),
        insert: (...a: unknown[]) => {
          insertMock(...a);
          return Promise.resolve({ error: null });
        },
        update: (...a: unknown[]) => {
          updateMock(...a);
          return { eq: (...e: unknown[]) => {
            eqUpdateMock(...e);
            return Promise.resolve({ error: null });
          } };
        },
      };
    }
    if (table === "locations") {
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: sampleLocations, error: null }),
          }),
        }),
      };
    }
    return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
  });
}

beforeEach(() => {
  fromMock.mockReset();
  insertMock.mockReset();
  updateMock.mockReset();
  eqUpdateMock.mockReset();
  toastMock.mockReset();
  setupSupabase();
});

async function selectLocation(name: RegExp) {
  // Radix Select needs keyboard nav in jsdom (same pattern as ShiftFormDialog).
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("option", { name });
  fireEvent.keyDown(option, { key: "Enter" });
}

async function openCreateDialog() {
  const button = await screen.findByRole("button", { name: /add department/i });
  fireEvent.click(button);
  await screen.findByRole("dialog");
}

describe("AdminDepartments dialog (#119)", () => {
  it("validates location: shows toast and skips insert when no location is selected", async () => {
    render(<AdminDepartments />);
    await openCreateDialog();
    fireEvent.change(screen.getByPlaceholderText(/therapeutic recreation/i), {
      target: { value: "New Dept" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create department/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Location is required.",
        variant: "destructive",
      }));
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("on valid create, includes location_id in the insert payload and omits min_age when blank", async () => {
    render(<AdminDepartments />);
    await openCreateDialog();
    fireEvent.change(screen.getByPlaceholderText(/therapeutic recreation/i), {
      target: { value: "New Dept" },
    });
    await selectLocation(/cedar rapids/i);
    fireEvent.click(screen.getByRole("button", { name: /create department/i }));

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledTimes(1);
    });
    const payload = insertMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "New Dept",
      location_id: "loc-2",
    });
    // Schema default (18) should apply on the DB side — payload must not
    // carry min_age at all when the input was blank.
    expect(payload).not.toHaveProperty("min_age");
  });

  it("on edit with blank min_age, the update payload omits min_age (must not be null)", async () => {
    render(<AdminDepartments />);
    // Open edit on the seeded department.
    const editButtons = await screen.findAllByRole("button");
    // The pencil button is the first action button in the row.
    const pencil = editButtons.find((b) => b.querySelector(".lucide-pencil"));
    expect(pencil).toBeTruthy();
    fireEvent.click(pencil!);
    await screen.findByRole("dialog");

    // Clear min_age (was 18 from the fixture).
    const dialog = screen.getByRole("dialog");
    const minAgeInput = within(dialog).getByPlaceholderText(/leave blank for no minimum/i);
    fireEvent.change(minAgeInput, { target: { value: "" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
    const payload = updateMock.mock.calls[0][0];
    // The fix: omit, not null. Schema default of 18 will apply.
    expect(payload).not.toHaveProperty("min_age");
    expect(payload.location_id).toBe("loc-1");
    expect(eqUpdateMock).toHaveBeenCalledWith("id", "dept-1");
  });
});
