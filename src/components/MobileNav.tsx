import { useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
  Clock,
  Settings,
  Users,
  Shield,
  LogOut,
  Loader2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  roles?: ("volunteer" | "coordinator" | "admin")[];
}

interface MobileNavProps {
  userRole: "volunteer" | "coordinator" | "admin";
  userName?: string;
}

/* ------------------------------------------------------------------ */
/*  Navigation map                                                     */
/* ------------------------------------------------------------------ */

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: Home },
  { label: "Browse Shifts", to: "/shifts", icon: Calendar },
  { label: "My Shifts", to: "/my-shifts", icon: Clock },
  { label: "Events", to: "/events", icon: Users },
  { label: "Settings", to: "/settings", icon: Settings },
  {
    label: "Coverage",
    to: "/coverage",
    icon: Shield,
    roles: ["coordinator", "admin"],
  },
  {
    label: "Admin",
    to: "/admin",
    icon: Shield,
    roles: ["admin"],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MobileNav({ userRole, userName }: MobileNavProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(userRole)
  );

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

  /* Active link style helper */
  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    [
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
      isActive
        ? "bg-[#006B3E]/10 text-[#006B3E]"
        : "text-gray-700 hover:bg-gray-100",
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

      <SheetContent side="left" className="flex w-72 flex-col p-0">
        {/* ---- Header ---- */}
        <SheetHeader className="border-b px-4 py-4">
          <SheetTitle className="text-left text-lg font-bold text-[#006B3E]">
            Easterseals Iowa
          </SheetTitle>
          {userName && (
            <p className="text-left text-xs text-gray-500">
              Signed in as <span className="font-medium">{userName}</span>
            </p>
          )}
        </SheetHeader>

        {/* ---- Links ---- */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          <ul className="space-y-1">
            {visibleItems.map((item) => (
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
        </nav>

        {/* ---- Sign Out ---- */}
        <div className="border-t px-3 py-4">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            {signingOut ? "Signing out…" : "Sign Out"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
