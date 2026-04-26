import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { Leaf, MessageSquare, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useUnreadCount } from "@/hooks/useUnreadCount";
import { useNavigate } from "react-router-dom";

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const { profile } = useAuth();
  const { unreadCount } = useUnreadCount();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        {!isMobile && <AppSidebar />}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Green accent top line */}
          <div className="h-1 bg-primary w-full" />
          <header className="h-14 flex items-center border-b border-border px-4 gap-3 bg-background" role="banner">
            {!isMobile && <SidebarTrigger />}
            <div className="flex items-center gap-2.5 flex-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary" aria-hidden="true">
                <Leaf className="h-5 w-5 text-primary-foreground" />
              </div>
              <h1 className="text-lg font-bold text-foreground hidden sm:block">Easterseals Iowa</h1>
              <h1 className="text-lg font-bold text-foreground sm:hidden">Easterseals</h1>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="p-2 rounded-md hover:bg-muted transition-colors"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate("/messages")}
                  className="relative p-2 rounded-md hover:bg-muted transition-colors"
                  aria-label={`Messages${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
                >
                  <MessageSquare className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[1rem] px-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {unreadCount > 0
                  ? `Messages (${unreadCount} unread)`
                  : "Messages"}
              </TooltipContent>
            </Tooltip>
            <NotificationBell />
          </header>
          <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-auto" role="main" style={{ paddingBottom: 'max(6rem, calc(6rem + env(safe-area-inset-bottom)))' }}>
            {children}
          </main>
        </div>
        {isMobile && (
          <MobileNav
            userRole={profile?.role as "volunteer" | "coordinator" | "admin" | undefined}
            userName={profile?.full_name || undefined}
          />
        )}
      </div>
    </SidebarProvider>
  );
}
