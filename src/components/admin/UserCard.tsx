import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, Unlock, Trash2, Building2 } from "lucide-react";
import { VolunteerReliabilityBadge } from "@/components/VolunteerReliabilityBadge";
import { roleBadgeClass, getBgCheckBadgeClass } from "@/lib/admin-user-utils";
import type { AdminProfile, AdminUserRole } from "@/hooks/useAdminUsers";

export interface UserCardActions {
  onRoleChangeRequest: (profileId: string, name: string, currentRole: AdminUserRole, newRole: AdminUserRole) => void;
  onDeptAssignRequest: (userId: string, name: string) => void;
  onToggleActive: (id: string, current: boolean) => void;
  onToggleBooking: (id: string, current: boolean) => void;
  onToggleMessaging: (id: string, current: boolean) => void;
  onBgCheckChange: (id: string, status: "cleared" | "pending" | "failed" | "expired") => void;
  onDeleteRequest: (id: string, name: string, role: AdminUserRole) => void;
  onManageMinorConsent: (profileId: string) => void;
}

interface Props {
  profile: AdminProfile;
  adminCount: number;
  actions: UserCardActions;
}

/**
 * Single profile card with the full set of admin action triggers. Pure
 * presentational — every interaction calls back to the page via the
 * `actions` object, which owns the supabase mutations + toast plumbing
 * (orchestration concerns) plus the audit-log-affecting flows.
 */
export function UserCard({ profile: p, adminCount, actions }: Props) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{p.full_name}</span>
              <Badge className={`text-xs ${roleBadgeClass[p.role] || ""}`}>{p.role}</Badge>
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
            {p.role === "volunteer" && p.is_minor && (
              <div className="text-xs text-muted-foreground">
                Minor (DOB: {p.date_of_birth}) —{" "}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs text-primary"
                  onClick={() => actions.onManageMinorConsent(p.id)}
                >
                  Manage Consent
                </Button>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <Badge className={`text-xs ${getBgCheckBadgeClass(p.bg_check_status)}`}>{p.bg_check_status}</Badge>
              {!p.booking_privileges && <Badge variant="outline" className="text-xs">No Booking</Badge>}
              {p.messaging_blocked && <Badge variant="destructive" className="text-xs">Messaging Blocked</Badge>}
              {p.is_minor && <Badge className="text-xs bg-yellow-500 text-white">Minor</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
            {/* Role dropdown */}
            <Select
              value={p.role}
              onValueChange={(v) => actions.onRoleChangeRequest(p.id, p.full_name, p.role, v as AdminUserRole)}
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

            {(p.role === "coordinator" || p.role === "admin") && (
              <Button size="sm" variant="outline" onClick={() => actions.onDeptAssignRequest(p.id, p.full_name)}>
                <Building2 className="h-3 w-3 mr-1" />
                Assign Depts
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => actions.onToggleActive(p.id, p.is_active)}>
              {p.is_active ? <Lock className="h-3 w-3 mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
              {p.is_active ? "Deactivate" : "Activate"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => actions.onToggleBooking(p.id, p.booking_privileges)}>
              {p.booking_privileges ? "Revoke Booking" : "Grant Booking"}
            </Button>
            {p.role !== "admin" && (
              <Button size="sm" variant="outline" onClick={() => actions.onToggleMessaging(p.id, p.messaging_blocked === true)}>
                {p.messaging_blocked ? "Unblock Messaging" : "Block Messaging"}
              </Button>
            )}
            <Select onValueChange={(v) => actions.onBgCheckChange(p.id, v as "cleared" | "pending" | "failed" | "expired")}>
              <SelectTrigger className="h-8 w-full sm:w-[140px] text-xs"><SelectValue placeholder="BG Check" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cleared">Cleared</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            {p.role !== "admin" && (
              <Button size="sm" variant="destructive" onClick={() => actions.onDeleteRequest(p.id, p.full_name, p.role)}>
                <Trash2 className="h-3 w-3 mr-1" /> Delete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
