import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Search, Lock, Unlock, UserPlus, Copy, AlertTriangle, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { VolunteerReliabilityBadge } from "@/components/VolunteerReliabilityBadge";


type UserRole = "volunteer" | "coordinator" | "admin";

const roleBadgeClass: Record<UserRole, string> = {
  admin: "bg-[hsl(153,100%,21%)] text-white",
  coordinator: "bg-[hsl(221,100%,27%)] text-white",
  volunteer: "bg-muted text-muted-foreground",
};

function generatePassword(length = 14): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join("");
}

export default function AdminUsers() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  // Role change confirmation
  const [roleChange, setRoleChange] = useState<{ id: string; name: string; from: UserRole; to: UserRole } | null>(null);
  const [roleChanging, setRoleChanging] = useState(false);

  // Delete user
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; role: UserRole } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Add user modal
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"coordinator" | "admin">("coordinator");
  const [addingUser, setAddingUser] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string } | null>(null);
  const [newNameError, setNewNameError] = useState("");
  const [newEmailError, setNewEmailError] = useState("");

  useEffect(() => {
    const fetchProfiles = async () => {
      const { data } = await supabase.from("profiles").select("*").order("full_name");
      setProfiles(data || []);
      setLoading(false);
    };
    fetchProfiles();
  }, []);

  const adminCount = profiles.filter((p) => p.role === "admin").length;

  const handleToggleActive = async (id: string, current: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_active: !current }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, is_active: !current } : p));
    toast({ title: `User ${!current ? "activated" : "deactivated"}` });
  };

  const handleToggleBooking = async (id: string, current: boolean) => {
    const { error } = await supabase.from("profiles").update({ booking_privileges: !current }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, booking_privileges: !current } : p));
    toast({ title: `Booking privileges ${!current ? "granted" : "revoked"}` });
  };

  const handleToggleMessaging = async (id: string, current: boolean) => {
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ messaging_blocked: !current })
      .eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, messaging_blocked: !current } as any : p));
    toast({ title: `Messaging ${!current ? "blocked" : "unblocked"}` });
  };

  const handleBgCheck = async (id: string, status: "cleared" | "pending" | "failed" | "expired") => {
    const { error } = await supabase.from("profiles").update({
      bg_check_status: status,
      bg_check_updated_at: new Date().toISOString(),
      bg_check_expires_at: status === "cleared" ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null,
    }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, bg_check_status: status } : p));
    toast({ title: `Background check: ${status}` });
  };

  // Role change intent
  const initiateRoleChange = (profileId: string, name: string, currentRole: UserRole, newRole: UserRole) => {
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
  };

  const confirmRoleChange = async () => {
    if (!roleChange) return;
    setRoleChanging(true);
    const { error } = await supabase.from("profiles").update({ role: roleChange.to }).eq("id", roleChange.id);
    setRoleChanging(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setProfiles((prev) => prev.map((p) => p.id === roleChange.id ? { ...p, role: roleChange.to } : p));
      toast({ title: `${roleChange.name}'s role updated to ${roleChange.to}` });
    }
    setRoleChange(null);
  };

  const roleChangeDescription = () => {
    if (!roleChange) return "";
    const { to } = roleChange;
    if (to === "coordinator") return "This volunteer will gain access to the coordinator dashboard for their assigned department.";
    if (to === "admin") return "Admins have full access to all data. There can only be 2 admins at any time.";
    return "";
  };

  // Delete user
  const confirmDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("delete-user", {
      body: { userId: deleteTarget.id },
    });
    setDeleting(false);
    if (error || data?.error) {
      toast({ title: "Error", description: data?.error || error?.message || "Failed to delete user", variant: "destructive" });
    } else {
      setProfiles((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast({ title: `${deleteTarget.name}'s account has been deleted.` });
    }
    setDeleteTarget(null);
  };

  const validateAddUser = () => {
    let valid = true;
    setNewNameError("");
    setNewEmailError("");
    const trimName = newName.trim();
    const trimEmail = newEmail.trim();
    if (!trimName || trimName.length < 2 || trimName.length > 100) {
      setNewNameError("Name must be 2–100 characters"); valid = false;
    }
    if (!trimEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail) || trimEmail.length > 255) {
      setNewEmailError("Enter a valid email (max 255 chars)"); valid = false;
    }
    return valid;
  };

  const handleAddUser = async () => {
    if (!validateAddUser()) return;
    if (newRole === "admin" && adminCount >= 2) {
      toast({ title: "Admin limit reached", description: "Maximum of 2 admins allowed.", variant: "destructive" });
      return;
    }
    setAddingUser(true);
    const password = generatePassword();

    // Use Supabase Auth admin createUser via edge function or signUp
    // Since we don't have service_role on client, we use signUp which auto-confirms if configured
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: newEmail.trim(),
      password,
      options: { data: { full_name: newName.trim() } },
    });

    if (authError || !authData.user) {
      setAddingUser(false);
      toast({ title: "Error creating user", description: authError?.message || "Unknown error", variant: "destructive" });
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: authData.user.id,
      email: newEmail.trim(),
      full_name: newName.trim(),
      role: newRole,
      is_active: true,
    });

    setAddingUser(false);

    if (profileError) {
      toast({ title: "User created but profile insert failed", description: profileError.message, variant: "destructive" });
      return;
    }

    // Refresh profiles list
    const { data: refreshed } = await supabase.from("profiles").select("*").order("full_name");
    if (refreshed) setProfiles(refreshed);

    setCreatedCreds({ email: newEmail.trim(), password });
    setNewName("");
    setNewEmail("");
    setNewRole("coordinator");
  };

  const closeAddUser = () => {
    setAddUserOpen(false);
    setCreatedCreds(null);
    setNewName("");
    setNewEmail("");
    setNewRole("coordinator");
    setNewNameError("");
    setNewEmailError("");
  };

  const filtered = profiles
    .filter((p) => roleFilter === "all" || p.role === roleFilter)
    .filter((p) => !search || p.full_name?.toLowerCase().includes(search.toLowerCase()) || p.email?.toLowerCase().includes(search.toLowerCase()));

  const bgBadge = (status: string) => {
    const map: Record<string, string> = { cleared: "bg-success text-success-foreground", pending: "bg-warning text-warning-foreground", failed: "bg-destructive text-destructive-foreground", expired: "bg-muted text-muted-foreground" };
    return <Badge className={`text-xs ${map[status] || ""}`}>{status}</Badge>;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">User Management</h2>
        <Button onClick={() => setAddUserOpen(true)} className="gap-1">
          <UserPlus className="h-4 w-4" /> Add User
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="volunteer">Volunteer</SelectItem>
            <SelectItem value="coordinator">Coordinator</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        {filtered.map((p) => (
          <Card key={p.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{p.full_name}</span>
                    <Badge className={`text-xs ${roleBadgeClass[p.role as UserRole] || ""}`}>
                      {p.role}
                    </Badge>
                    {!p.is_active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                    {p.role === "volunteer" && (
                      <VolunteerReliabilityBadge volunteerId={p.id} />
                    )}
                  </div>
                 <div className="text-sm text-muted-foreground">{p.email}</div>
                  {p.role === "volunteer" && (p.emergency_contact_name || p.emergency_contact_phone) && (
                    <div className="text-xs text-muted-foreground">
                      Emergency: {p.emergency_contact_name}{p.emergency_contact_name && p.emergency_contact_phone ? " · " : ""}{p.emergency_contact_phone}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {bgBadge(p.bg_check_status)}
                    {!p.booking_privileges && <Badge variant="outline" className="text-xs">No Booking</Badge>}
                    {(p as any).messaging_blocked && <Badge variant="destructive" className="text-xs">Messaging Blocked</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
                  {/* Role dropdown */}
                  <Select
                    value={p.role}
                    onValueChange={(v) => initiateRoleChange(p.id, p.full_name, p.role as UserRole, v as UserRole)}
                  >
                    <SelectTrigger className="h-8 w-full sm:w-[130px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="volunteer">Volunteer</SelectItem>
                      <SelectItem value="coordinator">Coordinator</SelectItem>
                      <SelectItem value="admin" disabled={adminCount >= 2 && p.role !== "admin"}>
                        {adminCount >= 2 && p.role !== "admin" ? "Admin (limit reached)" : "Admin"}
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <Button size="sm" variant="outline" onClick={() => handleToggleActive(p.id, p.is_active)}>
                    {p.is_active ? <Lock className="h-3 w-3 mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
                    {p.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleToggleBooking(p.id, p.booking_privileges)}>
                    {p.booking_privileges ? "Revoke Booking" : "Grant Booking"}
                  </Button>
                  {p.role !== "admin" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleMessaging(p.id, (p as any).messaging_blocked === true)}
                    >
                      {(p as any).messaging_blocked ? "Unblock Messaging" : "Block Messaging"}
                    </Button>
                  )}
                  <Select onValueChange={(v) => handleBgCheck(p.id, v as "cleared" | "pending" | "failed" | "expired")}>
                    <SelectTrigger className="h-8 w-full sm:w-[140px] text-xs"><SelectValue placeholder="BG Check" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cleared">Cleared</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                  {p.role !== "admin" && (
                    <Button size="sm" variant="destructive" onClick={() => setDeleteTarget({ id: p.id, name: p.full_name, role: p.role as UserRole })}>
                      <Trash2 className="h-3 w-3 mr-1" /> Delete
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Role change confirmation */}
      <AlertDialog open={!!roleChange} onOpenChange={(open) => { if (!open) setRoleChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to change {roleChange?.name}'s role to {roleChange?.to}?
            </AlertDialogDescription>
            {roleChange && (roleChange.to === "coordinator" || roleChange.to === "admin") && (
              <div className="flex items-start gap-2 mt-2 p-3 rounded-md bg-warning/10 border border-warning/30">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <p className="text-sm text-foreground">{roleChangeDescription()}</p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={roleChanging}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRoleChange} disabled={roleChanging}>
              {roleChanging ? "Updating..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete user confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account — This Cannot Be Undone</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete {deleteTarget?.name}'s account. This action cannot be reversed. If this user wishes to use the portal again they will need to register a new account.
            </AlertDialogDescription>
            {deleteTarget && (
              <div className="flex items-start gap-2 mt-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-sm text-foreground">
                  {deleteTarget.role === "volunteer"
                    ? "All of their active shift bookings will be automatically cancelled."
                    : "Their created shifts will remain unchanged."}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUser} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add user modal */}
      <Dialog open={addUserOpen} onOpenChange={(open) => { if (!open) closeAddUser(); else setAddUserOpen(true); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a coordinator or admin account. Volunteers self-register.</DialogDescription>
          </DialogHeader>

          {createdCreds ? (
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-success/10 border border-success/30 space-y-2">
                <p className="text-sm font-medium text-foreground">User created successfully!</p>
                <p className="text-sm text-muted-foreground">Share these credentials securely with the new user.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold">Email</Label>
                <div className="flex gap-2">
                  <Input value={createdCreds.email} readOnly className="text-sm" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(createdCreds.email); toast({ title: "Copied!" }); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold">Password</Label>
                <div className="flex gap-2">
                  <Input value={createdCreds.password} readOnly className="text-sm font-mono" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(createdCreds.password); toast({ title: "Copied!" }); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeAddUser}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs font-bold">Full Name</Label>
                <Input value={newName} onChange={(e) => { setNewName(e.target.value); setNewNameError(""); }} placeholder="Jane Smith" maxLength={100} />
                {newNameError && <p className="text-xs text-destructive">{newNameError}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">Email</Label>
                <Input type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setNewEmailError(""); }} placeholder="jane@example.com" maxLength={255} />
                {newEmailError && <p className="text-xs text-destructive">{newEmailError}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">Role</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as "coordinator" | "admin")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="coordinator">Coordinator</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newRole === "admin" && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <p className="text-xs text-foreground">Admins have full access to all data. There can only be 2 admins at any time.</p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeAddUser}>Cancel</Button>
                <Button onClick={handleAddUser} disabled={addingUser}>
                  {addingUser ? "Creating..." : "Create User"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
