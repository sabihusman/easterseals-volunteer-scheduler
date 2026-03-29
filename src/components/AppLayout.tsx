import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { NotificationBell } from "@/components/NotificationBell";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { Leaf } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const { profile } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        {!isMobile && <AppSidebar />}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b px-4 gap-3 bg-card" role="banner">
            {!isMobile && <SidebarTrigger />}
            <div className="flex items-center gap-2 flex-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary" aria-hidden="true">
                <Leaf className="h-4 w-4 text-primary-foreground" />
              </div>
              <h1 className="text-lg font-semibold hidden sm:block">Easterseals Volunteer Scheduler</h1>
              <h1 className="text-lg font-semibold sm:hidden">Easterseals</h1>
            </div>
            <NotificationBell />
          </header>
          <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-auto" role="main">
            {children}
          </main>
        </div>
        {isMobile && <MobileNav />}
      </div>
    </SidebarProvider>
  );
}
