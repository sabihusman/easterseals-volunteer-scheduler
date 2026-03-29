import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "@/components/NavLink";
import { Home, Calendar, ClipboardList, Building2, Shield } from "lucide-react";

export function MobileNav() {
  const { role } = useAuth();

  const items = [
    { title: "Shifts", url: "/dashboard", icon: Home },
    ...(role === "volunteer" ? [{ title: "Browse", url: "/shifts", icon: Calendar }] : []),
    { title: "History", url: "/history", icon: ClipboardList },
  ];

  if (role === "coordinator" || role === "admin") {
    items.push({ title: "Dept", url: "/coordinator", icon: Building2 });
  }
  if (role === "admin") {
    items.push({ title: "Admin", url: "/admin", icon: Shield });
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card md:hidden" role="navigation" aria-label="Mobile navigation">
      <div className="flex items-center justify-around py-2">
        {items.map((item) => (
          <NavLink
            key={item.url}
            to={item.url}
            end
            className="flex flex-col items-center gap-1 px-3 py-1 text-xs text-muted-foreground"
            activeClassName="text-primary font-medium"
          >
            <item.icon className="h-5 w-5" />
            <span>{item.title}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
