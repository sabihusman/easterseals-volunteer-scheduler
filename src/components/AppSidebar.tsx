import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Calendar, ClipboardList, Users, Shield, Settings, LogOut, Home, Building2, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppSidebar() {
  const { role, profile, signOut } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const volunteerItems = [
    { title: "My Shifts", url: "/dashboard", icon: Home },
    ...(role === "volunteer" ? [{ title: "Browse Shifts", url: "/shifts", icon: Calendar }] : []),
    { title: "My History", url: "/history", icon: ClipboardList },
  ];

  const coordinatorItems = [
    { title: "Department Shifts", url: "/coordinator", icon: Building2 },
    { title: "Manage Shifts", url: "/coordinator/manage", icon: Settings },
  ];

  const adminItems = [
    { title: "All Shifts", url: "/admin", icon: Calendar },
    { title: "Users", url: "/admin/users", icon: Users },
    { title: "Reminders", url: "/admin/reminders", icon: Bell },
    { title: "Admin Settings", url: "/admin/settings", icon: Shield },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {!collapsed && "Easterseals"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {volunteerItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end>
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(role === "coordinator" || role === "admin") && (
          <SidebarGroup>
            <SidebarGroupLabel>{!collapsed && "Coordinator"}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {coordinatorItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink to={item.url} end>
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
            <SidebarGroupLabel>{!collapsed && "Admin"}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <NavLink to={item.url} end>
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
      </SidebarContent>

      <SidebarFooter>
        <div className={`p-2 ${collapsed ? "text-center" : ""}`}>
          {!collapsed && (
            <p className="text-xs text-sidebar-foreground/70 mb-2 truncate">
              {profile?.full_name}
            </p>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Sign Out</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
