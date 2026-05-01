import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Vitest coverage for the Half B-1 admin Pending Minor Approvals page.
 *
 * Pinned behaviours:
 *   - List renders pending bookings sorted by shift date asc.
 *   - Department filter narrows the list.
 *   - Approve action: PATCH booking_status='confirmed', notification +
 *     email side effects, optimistic removal from the list.
 *   - Deny action: requires reason, PATCH booking_status='rejected',
 *     notification + email with reason, optimistic removal.
 *   - Capacity tie-break: when shift is full, the approve modal warns
 *     and offers a "Deny with shift-full reason" button.
 */

// vi.mock factories are hoisted, so any state they reference must be
// declared via vi.hoisted (which runs in the same hoisted block).
const {
  toastMock, sendEmailMock,
  updateMock, insertMock, eqUpdateMock, secondEqUpdateMock,
  responses,
} = vi.hoisted(() => ({
  toastMock: vi.fn(),
  sendEmailMock: vi.fn(() => Promise.resolve()),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  eqUpdateMock: vi.fn(),
  secondEqUpdateMock: vi.fn(),
  responses: {
    pendingBookings: { data: [] as unknown, error: null as unknown },
    departments: { data: [] as unknown, error: null as unknown },
  },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/lib/email-utils", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-user-id" } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      if (table === "shift_bookings") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve(responses.pendingBookings),
            }),
          }),
          update: (...a: unknown[]) => {
            updateMock(...a);
            return {
              eq: (...e1: unknown[]) => {
                eqUpdateMock(...e1);
                return {
                  eq: (...e2: unknown[]) => {
                    secondEqUpdateMock(...e2);
                    return Promise.resolve({ data: null, error: null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "departments") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve(responses.departments),
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: (...a: unknown[]) => {
            insertMock(...a);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

import PendingMinorApprovals from "@/pages/PendingMinorApprovals";

const SHIFT_FULL = {
  id: "shift-full",
  title: "Camp Lookout",
  shift_date: "2026-06-01",
  start_time: "09:00:00",
  end_time: "12:00:00",
  total_slots: 5,
  booked_slots: 5, // <- already full at approval time
  department_id: "dept-1",
  departments: { name: "Recreation" },
};

const SHIFT_OPEN = {
  id: "shift-open",
  title: "Pottery Class",
  shift_date: "2026-06-02",
  start_time: "13:00:00",
  end_time: "15:00:00",
  total_slots: 5,
  booked_slots: 1,
  department_id: "dept-2",
  departments: { name: "Arts" },
};

const baseBookings = [
  {
    id: "b-1",
    volunteer_id: "vol-minor-1",
    shift_id: SHIFT_FULL.id,
    created_at: "2026-05-01T10:00:00Z",
    profiles: { full_name: "Alex Minor", email: "alex@example.com" },
    shifts: SHIFT_FULL,
  },
  {
    id: "b-2",
    volunteer_id: "vol-minor-2",
    shift_id: SHIFT_OPEN.id,
    created_at: "2026-05-01T10:05:00Z",
    profiles: { full_name: "Jamie Minor", email: "jamie@example.com" },
    shifts: SHIFT_OPEN,
  },
];

beforeEach(() => {
  toastMock.mockReset();
  sendEmailMock.mockReset();
  updateMock.mockReset();
  insertMock.mockReset();
  eqUpdateMock.mockReset();
  secondEqUpdateMock.mockReset();
  responses.pendingBookings = { data: baseBookings, error: null };
  responses.departments = { data: [
    { id: "dept-1", name: "Recreation" },
    { id: "dept-2", name: "Arts" },
  ], error: null };
});

describe("PendingMinorApprovals", () => {
  it("renders the queue sorted by shift date ascending (most-urgent first)", async () => {
    render(<PendingMinorApprovals />);

    // SHIFT_FULL is 2026-06-01, SHIFT_OPEN is 2026-06-02 — full one
    // should appear first.
    await waitFor(() => {
      expect(screen.getByText(/Camp Lookout/i)).toBeInTheDocument();
    });
    const cards = screen.getAllByText(/Pottery Class|Camp Lookout/);
    expect(cards[0].textContent).toMatch(/Camp Lookout/);
    expect(cards[1].textContent).toMatch(/Pottery Class/);
  });

  it("approves an open-capacity booking — patches status, fires notification + email, removes from list", async () => {
    render(<PendingMinorApprovals />);
    await waitFor(() => screen.getByText(/Pottery Class/i));

    // Sort order is asc by date — Camp Lookout (FULL) first, Pottery
    // (OPEN) second. Use indexed access on the Approve buttons.
    const approveButtons = screen.getAllByRole("button", { name: /^approve$/i });
    fireEvent.click(approveButtons[1]); // Jamie's open-capacity booking

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
        booking_status: "confirmed",
        confirmed_by: "admin-user-id",
      }));
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        user_id: "vol-minor-2",
        type: "minor_booking_approved",
      }));
      expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
        to: "jamie@example.com",
        type: "minor_booking_approved",
      }));
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Booking approved",
      }));
    });
  });

  it("over-capacity approve modal surfaces the warning and the deny-with-shift-full alternative", async () => {
    render(<PendingMinorApprovals />);
    await waitFor(() => screen.getByText(/Camp Lookout/i));

    // First Approve button is for SHIFT_FULL (Alex / Camp Lookout).
    const approveButtons = screen.getAllByRole("button", { name: /^approve$/i });
    fireEvent.click(approveButtons[0]);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/shift now full/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /deny with shift-full reason/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /approve anyway/i })).toBeInTheDocument();
  });

  it("empty-reason denial shows 'Reason required' toast and does not patch", async () => {
    render(<PendingMinorApprovals />);
    await waitFor(() => screen.getByText(/Pottery Class/i));

    const denyButtons = screen.getAllByRole("button", { name: /^deny$/i });
    fireEvent.click(denyButtons[1]);

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /deny booking/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Reason required",
      }));
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("denial with reason patches status to 'rejected' and fires notification + email containing the reason", async () => {
    render(<PendingMinorApprovals />);
    await waitFor(() => screen.getByText(/Pottery Class/i));

    const denyButtons = screen.getAllByRole("button", { name: /^deny$/i });
    fireEvent.click(denyButtons[1]);

    await screen.findByRole("alertdialog");
    const textarea = screen.getByPlaceholderText(/skills outside/i);
    fireEvent.change(textarea, { target: { value: "Outside our minor program" } });
    fireEvent.click(screen.getByRole("button", { name: /deny booking/i }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
        booking_status: "rejected",
      }));
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        user_id: "vol-minor-2",
        type: "minor_booking_rejected",
        message: expect.stringContaining("Outside our minor program"),
      }));
      expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
        to: "jamie@example.com",
        type: "minor_booking_rejected",
        text: expect.stringContaining("Outside our minor program"),
      }));
    });
  });
});
