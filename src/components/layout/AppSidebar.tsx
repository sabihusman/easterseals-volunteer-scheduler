import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "@/components/layout/NavLink";
import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Calendar, CalendarDays, ClipboardList, Users, Shield, Settings, LogOut, Home, Building2, Bell, FileText, Cog, FolderOpen, CheckSquare, MessageSquare, BarChart3, AlertCircle, Scale, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { MESSAGING_ENABLED, DOCUMENTS_ENABLED, NOTES_ENABLED } from "@/config/featureFlags";

export function AppSidebar() {
  const { role, profile, signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  // Pending-minor-approvals badge count for admins. Polled every 60s
  // (queue is slow-moving and a head-only count query is cheap). Live
  // subscription would be marginally better UX but adds another
  // realtime channel for a feature that's small-scale by design.
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(0);
  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    const fetchCount = async () => {
      const { count } = await (supabase as any)
        .from("shift_bookings")
        .select("id", { count: "exact", head: true })
        .eq("booking_status", "pending_admin_approval");
      if (!cancelled) setPendingApprovalsCount(count ?? 0);
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [role]);

  // Pilot dark-launch: filter out nav entries for hidden features.
  // See src/config/featureFlags.ts. When flags flip back to true,
  // the entries reappear automatically — no other code changes.
  const volunteerItems = role === "volunteer" ? [
    { title: "My Shifts", url: "/dashboard", icon: Home },
    { title: "Browse Shifts", url: "/shifts", icon: Calendar },
    { title: "Unactioned Shifts", url: "/unactioned", icon: AlertCircle },
    { title: "Events", url: "/events", icon: CalendarDays },
    { title: "My History", url: "/history", icon: ClipboardList },
    ...(NOTES_ENABLED
      ? [{ title: "My Notes", url: "/notes", icon: FileText }]
      : []),
    ...(DOCUMENTS_ENABLED
      ? [{ title: "Documents", url: "/documents", icon: FolderOpen }]
      : []),
    ...(MESSAGING_ENABLED
      ? [{ title: "Messages", url: "/messages", icon: MessageSquare }]
      : []),
  ] : [];

  const coordinatorItems = [
    { title: "Department Shifts", url: "/coordinator", icon: Building2 },
    { title: "Manage Shifts", url: "/coordinator/manage", icon: Settings },
    { title: "Unactioned Shifts", url: "/admin/unactioned-shifts", icon: AlertCircle },
    { title: "Reports", url: "/reports", icon: BarChart3 },
    ...(MESSAGING_ENABLED
      ? [{ title: "Messages", url: "/messages", icon: MessageSquare }]
      : []),
  ];

  const adminItems: { title: string; url: string; icon: typeof Calendar; badge?: number }[] = [
    { title: "All Shifts", url: "/admin", icon: Calendar },
    { title: "Users", url: "/admin/users", icon: Users },
    { title: "Departments", url: "/admin/departments", icon: Building2 },
    { title: "Events", url: "/admin/events", icon: CalendarDays },
    { title: "Unactioned Shifts", url: "/admin/unactioned-shifts", icon: AlertCircle },
    { title: "Pending Minor Approvals", url: "/admin/pending-minor-approvals", icon: UserCheck, badge: pendingApprovalsCount },
    { title: "Reminders", url: "/admin/reminders", icon: Bell },
    { title: "Admin Settings", url: "/admin/settings", icon: Shield },
    { title: "Compliance", url: "/admin/compliance", icon: CheckSquare },
    { title: "Disputes", url: "/admin/disputes", icon: Scale },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {volunteerItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>
              {!collapsed && <span className="uppercase-label">Volunteer</span>}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {volunteerItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink
                        to={item.url}
                        end
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                          isActive(item.url)
                            ? "border-l-[3px] border-l-primary bg-accent text-accent-foreground font-medium"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {(role === "coordinator" || role === "admin") && (
          <SidebarGroup>
            <SidebarGroupLabel>{!collapsed && <span className="uppercase-label">Coordinator</span>}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {coordinatorItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink
                        to={item.url}
                        end
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                          isActive(item.url)
                            ? "border-l-[3px] border-l-primary bg-accent text-accent-foreground font-medium"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>{!collapsed && <span className="uppercase-label">Admin</span>}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink
                        to={item.url}
                        end
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                          isActive(item.url)
                            ? "border-l-[3px] border-l-primary bg-accent text-accent-foreground font-medium"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span className="flex-1">{item.title}</span>}
                        {!collapsed && typeof item.badge === "number" && item.badge > 0 && (
                          <Badge variant="destructive" className="h-5 px-1.5 text-xs">{item.badge}</Badge>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className={`p-3 ${collapsed ? "text-center" : ""}`}>
          {!collapsed && (
            <p className="text-xs text-muted-foreground mb-2 truncate">
              {profile?.full_name}
            </p>
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive("/settings")}>
                <NavLink
                  to="/settings"
                  end
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive("/settings")
                      ? "border-l-[3px] border-l-primary bg-accent text-accent-foreground font-medium"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <Cog className="h-4 w-4" />
                  {!collapsed && <span>Settings</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted mt-1"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Sign Out</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
