import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { useAdminUsers, type AdminUserRole } from "@/hooks/useAdminUsers";
import { UserListFilters } from "@/components/admin/UserListFilters";
import { UserCard, type UserCardActions } from "@/components/admin/UserCard";
import { RoleChangeDialog, type RoleChangeTarget } from "@/components/admin/RoleChangeDialog";
import { DeleteUserDialog, type DeleteUserTarget } from "@/components/admin/DeleteUserDialog";
import { DeptAssignmentDialog, type DeptAssignTarget } from "@/components/admin/DeptAssignmentDialog";
import { AddUserDialog } from "@/components/admin/AddUserDialog";

/**
 * AdminUsers orchestrator.
 *
 * Handler ownership split:
 *   - Page handlers: 4 toggles + role-change confirm (audit-affecting +
 *     post-success chain) + delete confirm (audit-affecting + optimistic
 *     remove) + manage-minor-consent. These need toast plumbing and
 *     orchestration.
 *   - Dialog-owned: DeptAssignmentDialog (self-contained delete+insert),
 *     AddUserDialog (self-contained signUp + profile insert + credentials).
 */
export default function AdminUsers() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { profiles, departments, loading, refresh, optimisticUpdate, optimisticRemove } = useAdminUsers();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // Dialog targets — page tracks "what's open + with what context"
  const [roleChange, setRoleChange] = useState<RoleChangeTarget | null>(null);
  const [roleChanging, setRoleChanging] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteUserTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deptAssignTarget, setDeptAssignTarget] = useState<DeptAssignTarget | null>(null);
  const [addUserOpen, setAddUserOpen] = useState(false);

  const adminCount = profiles.filter((p) => p.role === "admin").length;

  // ── Toggle handlers ──
  async function handleToggleActive(id: string, current: boolean) {
    const { error } = await supabase.from("profiles").update({ is_active: !current }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    optimisticUpdate(id, { is_active: !current });
    toast({ title: `User ${!current ? "activated" : "deactivated"}` });
  }

  async function handleToggleBooking(id: string, current: boolean) {
    const { error } = await supabase.from("profiles").update({ booking_privileges: !current }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    optimisticUpdate(id, { booking_privileges: !current });
    toast({ title: `Booking privileges ${!current ? "granted" : "revoked"}` });
  }

  async function handleToggleMessaging(id: string, current: boolean) {
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ messaging_blocked: !current })
      .eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    optimisticUpdate(id, { messaging_blocked: !current });
    toast({ title: `Messaging ${!current ? "blocked" : "unblocked"}` });
  }

  async function handleBgCheck(id: string, status: "cleared" | "pending" | "failed" | "expired") {
    const { error } = await supabase.from("profiles").update({
      bg_check_status: status,
      bg_check_updated_at: new Date().toISOString(),
      bg_check_expires_at: status === "cleared" ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null,
    }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    optimisticUpdate(id, { bg_check_status: status });
    toast({ title: `Background check: ${status}` });
  }

  // ── Role change ──
  function initiateRoleChange(profileId: string, name: string, currentRole: AdminUserRole, newRole: AdminUserRole) {
    if (newRole === currentRole) return;
    if (profileId === user?.id) {
      toast({ title: "Not allowed", description: "You cannot change your own role. Ask the other admin to do this.", variant: "destructive" });
      return;
    }
    if (newRole === "admin" && adminCount >= 2) {
      toast({ title: "Admin limit reached", description: "Maximum of 2 admins allowed. Transfer an existing admin role first.", variant: "destructive" });
      return;
    }
    setRoleChange({ id: profileId, name, from: currentRole, to: newRole });
  }

  async function confirmRoleChange() {
    if (!roleChange) return;
    setRoleChanging(true);

    // Use .select() so PostgREST returns the updated row — without it a
    // silent RLS filter (0 rows affected) returns 204 with no error and
    // the UI thinks the update succeeded when it didn't.
    const { data, error } = await supabase
      .from("profiles")
      .update({ role: roleChange.to })
      .eq("id", roleChange.id)
      .select("id, role")
      .single();

    setRoleChanging(false);

    if (error || !data) {
      toast({
        title: "Error",
        description: error?.message || "Role update failed — the row may not have been updated. Check RLS policies.",
        variant: "destructive",
      });
      setRoleChange(null);
      return;
    }

    // Verify the returned role matches what we requested — a DB trigger
    // (e.g. enforce_admin_cap) might have intervened.
    if (data.role !== roleChange.to) {
      toast({
        title: "Warning",
        description: `Role was set to "${data.role}" instead of "${roleChange.to}". A database trigger may have intervened.`,
        variant: "destructive",
      });
    }

    optimisticUpdate(roleChange.id, { role: data.role as AdminUserRole });
    toast({ title: `${roleChange.name}'s role updated to ${data.role}` });

    // If promoted to coordinator, open department assignment in the same flow.
    const promotedName = roleChange.name;
    const promotedId = roleChange.id;
    const promotedTo = roleChange.to;
    setRoleChange(null);
    if (promotedTo === "coordinator") {
      setDeptAssignTarget({ userId: promotedId, name: promotedName });
    }
  }

  // ── Delete user ──
  async function confirmDeleteUser() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("delete-user", {
      body: { userId: deleteTarget.id },
    });
    setDeleting(false);
    if (error || data?.error) {
      toast({ title: "Error", description: data?.error || error?.message || "Failed to delete user", variant: "destructive" });
    } else {
      optimisticRemove(deleteTarget.id);
      toast({ title: `${deleteTarget.name}'s account has been deleted.` });
    }
    setDeleteTarget(null);
  }

  // ── Manage minor consent ──
  // Extracted from the inline onClick handler in the UserCard. Admin-only
  // path: check existing consent, otherwise capture a paper-form consent
  // via window.prompt and insert.
  async function handleManageMinorConsent(profileId: string) {
    const { data } = await supabase
      .from("parental_consents")
      .select("id, parent_name, is_active, expires_at")
      .eq("volunteer_id", profileId)
      .eq("is_active", true)
      .limit(1);
    if (data && data.length > 0) {
      toast({ title: "Consent on file", description: `Parent: ${(data[0] as any).parent_name}` });
      return;
    }
    const parentName = window.prompt("Enter parent/guardian name (for paper consent):");
    if (!parentName) return;
    const { error } = await (supabase as any).from("parental_consents").insert({
      volunteer_id: profileId,
      parent_name: parentName,
      parent_email: "paper-consent@easterseals.com",
      consent_method: "paper",
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Consent recorded", description: `Paper consent from ${parentName} recorded.` });
  }

  const filtered = profiles
    .filter((p) => roleFilter === "all" || p.role === roleFilter)
    .filter(
      (p) =>
        !search ||
        p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.email?.toLowerCase().includes(search.toLowerCase())
    );

  const cardActions: UserCardActions = {
    onRoleChangeRequest: initiateRoleChange,
    onDeptAssignRequest: (userId, name) => setDeptAssignTarget({ userId, name }),
    onToggleActive: handleToggleActive,
    onToggleBooking: handleToggleBooking,
    onToggleMessaging: handleToggleMessaging,
    onBgCheckChange: handleBgCheck,
    onDeleteRequest: (id, name, role) => setDeleteTarget({ id, name, role }),
    onManageMinorConsent: handleManageMinorConsent,
  };

  if (loading) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">User Management</h2>
        <Button onClick={() => setAddUserOpen(true)} className="gap-1">
          <UserPlus className="h-4 w-4" /> Add User
        </Button>
      </div>

      <UserListFilters
        search={search}
        onSearchChange={setSearch}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
      />

      <div className="grid gap-3">
        {filtered.map((p) => (
          <UserCard key={p.id} profile={p} adminCount={adminCount} actions={cardActions} />
        ))}
      </div>

      <RoleChangeDialog
        target={roleChange}
        loading={roleChanging}
        onConfirm={confirmRoleChange}
        onClose={() => setRoleChange(null)}
      />

      <DeleteUserDialog
        target={deleteTarget}
        loading={deleting}
        onConfirm={confirmDeleteUser}
        onClose={() => setDeleteTarget(null)}
      />

      <DeptAssignmentDialog
        target={deptAssignTarget}
        departments={departments}
        onClose={() => setDeptAssignTarget(null)}
      />

      <AddUserDialog
        open={addUserOpen}
        onOpenChange={setAddUserOpen}
        adminCount={adminCount}
        onUserCreated={refresh}
      />
    </div>
  );
}
