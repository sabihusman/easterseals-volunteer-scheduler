import { useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MESSAGING_ENABLED, DOCUMENTS_ENABLED, NOTES_ENABLED } from "@/config/featureFlags";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Menu,
  Home,
  Calendar,
  CalendarDays,
  ClipboardList,
  Clock,
  Settings,
  Cog,
  Users,
  Shield,
  LogOut,
  Loader2,
  FolderOpen,
  FileText,
  MessageSquare,
  Building2,
  Bell,
  CheckSquare,
  Scale,
  BarChart3,
  AlertCircle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

type UserRole = "volunteer" | "coordinator" | "admin";

interface MobileNavProps {
  userRole?: UserRole;
  userName?: string;
}

/* ------------------------------------------------------------------ */
/*  Role-based navigation — mirrors AppSidebar.tsx exactly.            */
/* ------------------------------------------------------------------ */

function getSections(role: UserRole): NavSection[] {
  const sections: NavSection[] = [];

  if (role === "volunteer") {
    sections.push({
      heading: "Volunteer",
      items: [
        // Pilot dark-launch: see src/config/featureFlags.ts
        { label: "My Shifts", to: "/dashboard", icon: Home },
        { label: "Browse Shifts", to: "/shifts", icon: Calendar },
        { label: "Unactioned Shifts", to: "/unactioned", icon: AlertCircle },
        { label: "Events", to: "/events", icon: CalendarDays },
        { label: "My History", to: "/history", icon: ClipboardList },
        ...(NOTES_ENABLED
          ? [{ label: "My Notes", to: "/notes", icon: FileText }]
          : []),
        ...(DOCUMENTS_ENABLED
          ? [{ label: "Documents", to: "/documents", icon: FolderOpen }]
          : []),
        ...(MESSAGING_ENABLED
          ? [{ label: "Messages", to: "/messages", icon: MessageSquare }]
          : []),
      ],
    });
  }

  if (role === "coordinator" || role === "admin") {
    sections.push({
      heading: "Coordinator",
      items: [
        { label: "Department Shifts", to: "/coordinator", icon: Building2 },
        { label: "Manage Shifts", to: "/coordinator/manage", icon: Settings },
        { label: "Unactioned Shifts", to: "/admin/unactioned-shifts", icon: AlertCircle },
        { label: "Reports", to: "/reports", icon: BarChart3 },
        ...(MESSAGING_ENABLED
          ? [{ label: "Messages", to: "/messages", icon: MessageSquare }]
          : []),
      ],
    });
  }

  if (role === "admin") {
    sections.push({
      heading: "Admin",
      items: [
        { label: "All Shifts", to: "/admin", icon: Calendar },
        { label: "Users", to: "/admin/users", icon: Users },
        { label: "Departments", to: "/admin/departments", icon: Building2 },
        { label: "Events", to: "/admin/events", icon: CalendarDays },
        { label: "Reminders", to: "/admin/reminders", icon: Bell },
        { label: "Admin Settings", to: "/admin/settings", icon: Shield },
        { label: "Compliance", to: "/admin/compliance", icon: CheckSquare },
        { label: "Disputes", to: "/admin/disputes", icon: Scale },
      ],
    });
  }

  // Common section at the bottom for all roles
  sections.push({
    heading: "",
    items: [
      { label: "Settings", to: "/settings", icon: Cog },
    ],
  });

  return sections;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MobileNav({ userRole = "volunteer", userName }: MobileNavProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const sections = getSections(userRole);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      navigate("/auth", { replace: true });
    } catch (error) {
      console.error("Sign-out failed:", error);
      setSigningOut(false);
    }
  };

  /* Active link style helper — uses theme-aware tokens */
  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    [
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
      isActive
        ? "bg-primary/10 text-primary"
        : "text-foreground hover:bg-muted",
    ].join(" ");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="flex w-72 flex-col p-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* ---- Header ---- */}
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="text-left text-lg font-bold text-primary">
            Easterseals Iowa
          </SheetTitle>
          {userName && (
            <p className="text-left text-xs text-muted-foreground">
              Signed in as <span className="font-medium">{userName}</span>
            </p>
          )}
        </SheetHeader>

        {/* ---- Links grouped by role ---- */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {sections.map((section) => (
            <div key={section.heading || "common"} className="mb-4 last:mb-0">
              {section.heading && (
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.heading}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={linkClasses}
                      onClick={() => setOpen(false)}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* ---- Sign Out ---- */}
        <div className="border-t px-3 py-4">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            {signingOut ? "Signing out..." : "Sign Out"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
