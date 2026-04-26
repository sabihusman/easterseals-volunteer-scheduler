import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Tier 2 test for RoleChangeDialog.
 *
 * Pure presentational AlertDialog. Tests verify the UI behavior only:
 *   - target=null → not rendered
 *   - role-aware warning copy
 *   - onConfirm wiring + loading-state disabling
 *
 * The RLS-aware "0 rows updated" guard lives in AdminUsers.tsx's
 * confirmRoleChange handler, NOT in this dialog. That guard is
 * page-layer; testing it would require mounting AdminUsers.
 */

import { RoleChangeDialog } from "@/components/admin/RoleChangeDialog";

const onConfirm = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  onConfirm.mockReset();
  onClose.mockReset();
});

describe("RoleChangeDialog", () => {
  it("does not render when target is null", () => {
    render(<RoleChangeDialog target={null} loading={false} onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the admin-promotion warning copy when promoting to admin", () => {
    render(
      <RoleChangeDialog
        target={{ id: "u1", name: "Alex", from: "coordinator", to: "admin" }}
        loading={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    expect(screen.getByText(/admins have full access to all data/i)).toBeInTheDocument();
    expect(screen.getByText(/2 admins/i)).toBeInTheDocument();
  });

  it("shows the coordinator-promotion warning copy when promoting to coordinator", () => {
    render(
      <RoleChangeDialog
        target={{ id: "u1", name: "Alex", from: "volunteer", to: "coordinator" }}
        loading={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    expect(screen.getByText(/coordinator dashboard for their assigned department/i)).toBeInTheDocument();
  });

  it("shows NO warning panel when demoting to volunteer", () => {
    render(
      <RoleChangeDialog
        target={{ id: "u1", name: "Alex", from: "coordinator", to: "volunteer" }}
        loading={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    // Neither warning copy should be present.
    expect(screen.queryByText(/admins have full access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coordinator dashboard/i)).not.toBeInTheDocument();
    // The base description still mentions the target role/name.
    expect(screen.getByText(/change Alex's role to volunteer/i)).toBeInTheDocument();
  });

  it("calls onConfirm on click; loading=true disables both Cancel and Confirm", () => {
    const { rerender } = render(
      <RoleChangeDialog
        target={{ id: "u1", name: "Alex", from: "volunteer", to: "coordinator" }}
        loading={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Now flip to loading=true.
    rerender(
      <RoleChangeDialog
        target={{ id: "u1", name: "Alex", from: "volunteer", to: "coordinator" }}
        loading={true}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    expect(screen.getByRole("button", { name: /updating/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
