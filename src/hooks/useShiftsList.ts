import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface Department {
  id: string;
  name: string;
}

export interface Shift {
  id: string;
  title: string;
  department_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  total_slots: number;
  /**
   * Status union matches the public.shift_status enum. Sprint 1 added
   * status-aware UI (Edit/Delete disabled on completed shifts), so this
   * field has to come back from the select.
   */
  status: "open" | "full" | "cancelled" | "completed";
  coordinator_note: string | null;
  departments?: { name: string };
}

interface UseShiftsListResult {
  shifts: Shift[];
  departments: Department[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads the shift list and department list for the ManageShifts page,
 * applying the same role-based scoping as the original page:
 *
 *   - admin: all active departments + all non-cancelled shifts
 *   - coordinator: only departments they're assigned to (via
 *     department_coordinators) + shifts in those departments
 *
 * Boundary cast applied once at the embedded-select response (matches the
 * documented pattern in eslint.config.js and PRs #125 / #127).
 */
export function useShiftsList(user: User | null, role: string | null): UseShiftsListResult {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user || !role) return;

    // ---- Departments ----
    if (role === "coordinator") {
      const { data } = await supabase
        .from("department_coordinators")
        .select("departments(id, name, is_active)")
        .eq("coordinator_id", user.id);
      const depts = ((data as any[]) || [])
        .map((row) => row.departments)
        .filter((d) => d && d.is_active)
        .map((d) => ({ id: d.id, name: d.name } as Department))
        .sort((a, b) => a.name.localeCompare(b.name));
      setDepartments(depts);
    } else {
      const { data } = await supabase
        .from("departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (data) setDepartments(data as Department[]);
    }

    // ---- Shifts ----
    let deptFilter: string[] | null = null;
    if (role === "coordinator") {
      const { data: assignments } = await supabase
        .from("department_coordinators")
        .select("department_id")
        .eq("coordinator_id", user.id);
      deptFilter = ((assignments as { department_id: string }[] | null) || []).map((a) => a.department_id);
      if (deptFilter.length === 0) {
        setShifts([]);
        return;
      }
    }

    let query = supabase
      .from("shifts")
      .select("*, departments(name)")
      // Don't show admin-cancelled shifts in the manage view
      .neq("status", "cancelled")
      .order("shift_date", { ascending: true });
    if (deptFilter) query = query.in("department_id", deptFilter);

    const { data } = await query;
    if (data) setShifts(data as Shift[]);
  }, [user, role]);

  useEffect(() => {
    // Wait for the auth user to resolve. Once it has, even if `role` is
    // still null (fresh account, race during sign-up), we must clear
    // `loading` so the page doesn't hang on its spinner. Issue #128:
    // ProtectedRoute already gates the route on role, so an empty
    // shifts/departments render here is the correct fallback.
    if (!user) return;
    if (!role) {
      setLoading(false);
      return;
    }
    refresh().then(() => setLoading(false));
  }, [user, role, refresh]);

  return { shifts, departments, loading, refresh };
}
