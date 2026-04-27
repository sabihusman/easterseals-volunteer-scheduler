import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

/**
 * Regression test for issue #128: ManageShifts spinner hang on null role.
 *
 * Before the fix, the hook's mount effect early-returned when role was
 * null, never flipping `loading` to false → ManageShifts stuck on its
 * spinner forever. The fix splits the guard: wait for `user`, but if
 * `role` is still null clear `loading` so the page can render an empty
 * fallback (the route guard is the real access check).
 */

// Chainable query builder that resolves to empty rows for any chain
// shape (.select().eq().order(), .select().eq().in(), etc.).
function chainable() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "neq", "order", "limit"]) {
    builder[m] = () => builder;
  }
  builder.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(onFulfilled);
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => chainable(),
  },
}));

import { useShiftsList } from "@/hooks/useShiftsList";

const fakeUser = { id: "user-1" } as unknown as User;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useShiftsList", () => {
  it("clears loading when user is loaded but role is still null (issue #128)", async () => {
    const { result } = renderHook(() => useShiftsList(fakeUser, null));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.shifts).toEqual([]);
    expect(result.current.departments).toEqual([]);
  });

  it("stays in loading while user is null (auth still resolving)", () => {
    const { result } = renderHook(() => useShiftsList(null, null));
    expect(result.current.loading).toBe(true);
  });

  it("loads data and clears loading when user + role are both present", async () => {
    const { result } = renderHook(() => useShiftsList(fakeUser, "admin"));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
