import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

/**
 * Shape of a shift_invitations row joined with its parent shift, as
 * returned by the dashboard's invitation select. The `as any` boundary
 * cast in fetchInvitations matches the documented pattern in
 * eslint.config.js — PostgREST embedded selects don't survive the
 * generated Database types cleanly.
 */
export interface ShiftInvitation {
  id: string;
  invited_by: string;
  expires_at: string;
  status: string;
  shifts: {
    id: string;
    title: string;
    shift_date: string;
    start_time: string | null;
    end_time: string | null;
    total_slots: number;
    booked_slots: number;
    department_id: string;
    departments: { name: string } | null;
  } | null;
}

interface UseShiftInvitationsResult {
  invitations: ShiftInvitation[];
  refresh: () => Promise<void>;
}

/**
 * Loads pending shift invitations for the given user. Filters out invitations
 * past `expires_at` client-side until the cron catches them.
 */
export function useShiftInvitations(user: User | null): UseShiftInvitationsResult {
  const [invitations, setInvitations] = useState<ShiftInvitation[]>([]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("shift_invitations")
      .select("*, shifts(id, title, shift_date, start_time, end_time, total_slots, booked_slots, department_id, departments(name))")
      .eq("volunteer_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const now = new Date();
    const fresh = ((data as any[]) || []).filter(
      (inv: { expires_at: string }) => new Date(inv.expires_at) > now
    ) as ShiftInvitation[];
    setInvitations(fresh);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { invitations, refresh };
}
