import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AdminUserRole = "volunteer" | "coordinator" | "admin";

/**
 * Profile shape as needed by the AdminUsers page. Extends the supabase
 * generated `Profile` row with three columns the type generator hasn't
 * picked up yet (`is_minor`, `date_of_birth`, `messaging_blocked`). Same
 * pattern as `SettingsProfile` / `AlertProfile` in earlier refactors.
 *
 * Page bridges with `profile as unknown as AdminProfile` once at the panel
 * boundary; sub-components accept the typed prop.
 */
export interface AdminProfile {
  id: string;
  full_name: string;
  email: string;
  role: AdminUserRole;
  is_active: boolean;
  booking_privileges: boolean;
  bg_check_status: "cleared" | "pending" | "failed" | "expired" | string;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  // Columns the type generator hasn't surfaced yet:
  is_minor: boolean;
  date_of_birth: string | null;
  messaging_blocked: boolean;
}

export interface AdminDepartment {
  id: string;
  name: string;
}

interface UseAdminUsersResult {
  profiles: AdminProfile[];
  departments: AdminDepartment[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Patch one profile in place (post-toggle / post-update). */
  optimisticUpdate: (id: string, patch: Partial<AdminProfile>) => void;
  /** Drop a profile from the list (post-delete). */
  optimisticRemove: (id: string) => void;
}

/**
 * Loads all profiles (admin-only page; admins see everything) plus the
 * active departments list for the assignment dialog. Boundary cast at the
 * supabase response — same documented pattern as PRs #125 / #127 / #129.
 */
export function useAdminUsers(): UseAdminUsersResult {
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [{ data: profilesData }, { data: deptsData }] = await Promise.all([
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    ]);
    setProfiles(((profilesData as any[]) || []) as AdminProfile[]);
    if (deptsData) setDepartments(deptsData as AdminDepartment[]);
  }, []);

  useEffect(() => {
    refresh().then(() => setLoading(false));
  }, [refresh]);

  const optimisticUpdate = useCallback((id: string, patch: Partial<AdminProfile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const optimisticRemove = useCallback((id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { profiles, departments, loading, refresh, optimisticUpdate, optimisticRemove };
}
