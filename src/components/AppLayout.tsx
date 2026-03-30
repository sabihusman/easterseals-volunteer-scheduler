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
            <NotificationBell />
          </header>
          <main className="flex-1 p-4 md:p-8 pb-20 md:pb-8 overflow-auto" role="main">
            {children}
          </main>
        </div>
        {isMobile && <MobileNav />}
      </div>
    </SidebarProvider>
  );
}
