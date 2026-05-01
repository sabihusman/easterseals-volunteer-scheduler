import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Tier 3 test for InviteVolunteerModal.
 *
 * The supabase from(table) call returns table-specific query builders;
 * we route based on the table argument so each table has its own
 * mockable surface.
 *
 * Search input is debounced (250ms) — tests use fake timers + advanceTimersByTime.
 */

const shiftInvitationsSelectMock = vi.fn();
const shiftInvitationsInsertMock = vi.fn();
const restrictionsSelectMock = vi.fn();
const profilesSelectMock = vi.fn();
const notificationsInsertMock = vi.fn();
const shiftBookingsSelectMock = vi.fn();
const toastMock = vi.fn();
const onSentMock = vi.fn();
const onOpenChangeMock = vi.fn();

const mockUser = { id: "coord-user-1" };

/**
 * Build a query-builder shape that resolves to the desired result. The
 * production code uses .select(...).eq(...).eq(...).not(...) chains for
 * shift_invitations and similar, so each method returns `this` until a
 * terminal `.then` (the await) resolves the promise.
 */
function chainable(result: unknown) {
  const builder: Record<string, unknown> = {};
  // Most methods return the builder; eq/ilike/limit/order/not all chain.
  for (const m of ["eq", "ilike", "order", "limit", "not", "in"]) {
    builder[m] = () => builder;
  }
  // Final await on the chain returns the result via the thenable interface.
  builder.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "shift_invitations") {
        return {
          select: () => chainable(shiftInvitationsSelectMock()),
          insert: (...a: unknown[]) => shiftInvitationsInsertMock(...a),
        };
      }
      if (table === "department_restrictions") {
        return { select: () => chainable(restrictionsSelectMock()) };
      }
      if (table === "profiles") {
        return { select: () => chainable(profilesSelectMock()) };
      }
      if (table === "notifications") {
        return { insert: (...a: unknown[]) => notificationsInsertMock(...a) };
      }
      if (table === "shift_bookings") {
        return { select: () => chainable(shiftBookingsSelectMock()) };
      }
      return { select: () => chainable({ data: [], error: null }) };
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { InviteVolunteerModal } from "@/components/shifts/InviteVolunteerModal";

const baseShift = {
  id: "shift-1",
  title: "Morning Crew",
  shift_date: "2026-06-15",
  start_time: "09:00:00",
  end_time: "12:00:00",
  department_id: "dept-1",
  total_slots: 4,
  departments: { name: "Grounds", requires_bg_check: false },
};

beforeEach(() => {
  shiftInvitationsSelectMock.mockReset();
  shiftInvitationsInsertMock.mockReset();
  restrictionsSelectMock.mockReset();
  profilesSelectMock.mockReset();
  notificationsInsertMock.mockReset();
  shiftBookingsSelectMock.mockReset();
  toastMock.mockReset();
  onSentMock.mockReset();
  onOpenChangeMock.mockReset();
  // Default: no one already invited, no restrictions, no conflicts.
  shiftInvitationsSelectMock.mockReturnValue({ data: [], error: null });
  restrictionsSelectMock.mockReturnValue({ data: [], error: null });
  shiftBookingsSelectMock.mockReturnValue({ data: [], error: null });
  shiftInvitationsInsertMock.mockResolvedValue({ error: null });
  notificationsInsertMock.mockResolvedValue({ error: null });
});

function renderOpen(shiftOverride: Partial<typeof baseShift> = {}) {
  render(
    <InviteVolunteerModal
      shift={{ ...baseShift, ...shiftOverride }}
      open={true}
      onOpenChange={onOpenChangeMock}
      onSent={onSentMock}
    />
  );
}

async function typeSearch(text: string) {
  const input = screen.getByPlaceholderText(/search by name/i);
  fireEvent.change(input, { target: { value: text } });
  // Real wait past the 250ms debounce. Using real timers because most tests
  // pair this with `waitFor`, which polls in real time and doesn't compose
  // with fake timers. Fake timers are isolated to the debounce-verification
  // test below.
  await new Promise((r) => setTimeout(r, 300));
}

describe("InviteVolunteerModal", () => {

  it("on mount, fetches existing pending invitations and department restrictions", async () => {
    renderOpen();
    // The mount-time Promise.all should fire both queries synchronously.
    await waitFor(() => {
      expect(shiftInvitationsSelectMock).toHaveBeenCalled();
      expect(restrictionsSelectMock).toHaveBeenCalled();
    });
  });

  it("typing in the search field debounces 250ms before firing the profiles query", async () => {
    profilesSelectMock.mockReturnValue({
      data: [{ id: "v1", full_name: "Jane Volunteer", email: "jane@example.com", bg_check_status: "cleared", is_active: true }],
      error: null,
    });
    renderOpen();
    // Wait for mount-time queries to settle on real timers.
    await waitFor(() => expect(restrictionsSelectMock).toHaveBeenCalled());

    // Verify debounce: at 100ms the query has NOT fired; at 300ms it HAS.
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: "Ja" } });
    await new Promise((r) => setTimeout(r, 100));
    expect(profilesSelectMock).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 250));
    await waitFor(() => {
      expect(profilesSelectMock).toHaveBeenCalled();
      expect(screen.getByText("Jane Volunteer")).toBeInTheDocument();
    });
  });

  it("eligibility filter: already-invited / restricted / BG-required-not-cleared all show their reason and disable the row", async () => {
    // Pre-populate state via the mount queries.
    shiftInvitationsSelectMock.mockReturnValue({
      data: [{ volunteer_id: "v-invited" }],
      error: null,
    });
    restrictionsSelectMock.mockReturnValue({
      data: [{ volunteer_id: "v-restricted" }],
      error: null,
    });
    profilesSelectMock.mockReturnValue({
      data: [
        { id: "v-invited", full_name: "Pat Pending", email: "a@x", bg_check_status: "cleared", is_active: true },
        { id: "v-restricted", full_name: "Robin Blocked", email: "r@x", bg_check_status: "cleared", is_active: true },
        { id: "v-needs-bg", full_name: "Sam Newcomer", email: "b@x", bg_check_status: "pending", is_active: true },
      ],
      error: null,
    });
    // Department requires BG check, so v-needs-bg becomes ineligible.
    renderOpen({ departments: { name: "Grounds", requires_bg_check: true } });
    await typeSearch("Vo");

    // Already invited
    const inviteRow = screen.getByText("Pat Pending").closest("button")!;
    expect(within(inviteRow).getByText(/already invited/i)).toBeInTheDocument();
    expect(inviteRow).toBeDisabled();
    // Restricted
    const restrRow = screen.getByText("Robin Blocked").closest("button")!;
    expect(within(restrRow).getByText(/restricted/i)).toBeInTheDocument();
    expect(restrRow).toBeDisabled();
    // BG-required + status=pending
    const bgRow = screen.getByText("Sam Newcomer").closest("button")!;
    expect(within(bgRow).getByText(/bg check.*pending/i)).toBeInTheDocument();
    expect(bgRow).toBeDisabled();
  });

  it("clicking an eligible volunteer opens the standard confirmation dialog when there's no time conflict", async () => {
    profilesSelectMock.mockReturnValue({
      data: [{ id: "v1", full_name: "Eligible Vol", email: "e@x", bg_check_status: "cleared", is_active: true }],
      error: null,
    });
    shiftBookingsSelectMock.mockReturnValue({ data: [], error: null });
    renderOpen();
    await typeSearch("Eli");
    fireEvent.click(screen.getByText("Eligible Vol").closest("button")!);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: /send invitation/i })).toBeInTheDocument();
    expect(within(dialog).queryByText(/scheduling conflict/i)).not.toBeInTheDocument();
  });

  it("clicking an eligible volunteer with a same-day overlap opens the conflict-warning dialog with the conflicting shift's details", async () => {
    profilesSelectMock.mockReturnValue({
      data: [{ id: "v1", full_name: "Conflicted Vol", email: "c@x", bg_check_status: "cleared", is_active: true }],
      error: null,
    });
    shiftBookingsSelectMock.mockReturnValue({
      data: [{
        shifts: {
          title: "Existing Shift",
          shift_date: "2026-06-15",
          start_time: "10:00:00",
          end_time: "13:00:00",
        },
      }],
      error: null,
    });
    renderOpen();
    await typeSearch("Con");
    fireEvent.click(screen.getByText("Conflicted Vol").closest("button")!);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/scheduling conflict/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/existing shift/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/10:00/)).toBeInTheDocument();
  });

  it("on Send (no conflict), inserts shift_invitations + notification, toasts success, calls onSent + onOpenChange(false)", async () => {
    profilesSelectMock.mockReturnValue({
      data: [{ id: "v1", full_name: "Eligible Vol", email: "e@x", bg_check_status: "cleared", is_active: true }],
      error: null,
    });
    renderOpen();
    await typeSearch("Eli");
    fireEvent.click(screen.getByText("Eligible Vol").closest("button")!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /send invitation/i }));

    await waitFor(() => {
      expect(shiftInvitationsInsertMock).toHaveBeenCalledWith(expect.objectContaining({
        shift_id: "shift-1",
        volunteer_id: "v1",
        invited_by: mockUser.id,
        invite_email: "e@x",
        status: "pending",
      }));
      expect(notificationsInsertMock).toHaveBeenCalledWith(expect.objectContaining({
        user_id: "v1",
        type: "shift_invitation",
      }));
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Invitation sent",
      }));
      expect(onSentMock).toHaveBeenCalled();
      expect(onOpenChangeMock).toHaveBeenCalledWith(false);
    });
  });

  it("on unique-violation insert error, shows the friendly message (not the raw constraint name)", async () => {
    profilesSelectMock.mockReturnValue({
      data: [{ id: "v1", full_name: "Eligible Vol", email: "e@x", bg_check_status: "cleared", is_active: true }],
      error: null,
    });
    shiftInvitationsInsertMock.mockResolvedValue({
      error: { message: 'duplicate key value violates unique constraint "uq_shift_invitation_volunteer"' },
    });
    renderOpen();
    await typeSearch("Eli");
    fireEvent.click(screen.getByText("Eligible Vol").closest("button")!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /send invitation/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to send invitation",
        description: "This volunteer already has a pending invitation for this shift.",
        variant: "destructive",
      }));
    });
    // Asserted exact user-visible text — the raw constraint name must not leak.
    const calls = toastMock.mock.calls.flat();
    const descriptions = calls.map((c) => (c as { description?: string }).description ?? "");
    for (const d of descriptions) {
      expect(d).not.toMatch(/uq_shift_invitation_volunteer|duplicate key/);
    }
  });

  it("on generic insert error, shows the supabase message verbatim in the toast", async () => {
    profilesSelectMock.mockReturnValue({
      data: [{ id: "v1", full_name: "Eligible Vol", email: "e@x", bg_check_status: "cleared", is_active: true }],
      error: null,
    });
    shiftInvitationsInsertMock.mockResolvedValue({
      error: { message: "RLS denied" },
    });
    renderOpen();
    await typeSearch("Eli");
    fireEvent.click(screen.getByText("Eligible Vol").closest("button")!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /send invitation/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to send invitation",
        description: "RLS denied",
        variant: "destructive",
      }));
    });
  });
});
