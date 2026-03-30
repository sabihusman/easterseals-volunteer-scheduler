import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

type Notification = {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  link: string | null;
  type: string;
};

export function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      setNotifications((data as Notification[]) || []);
    };
    fetch();

    const channel = supabase
      .channel("notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 30));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAllRead = async () => {
    if (!user) return;
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}>
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-auto py-1" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No notifications</div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`px-4 py-3 border-b last:border-0 ${n.type === "late_cancellation" ? "bg-destructive/10 border-l-4 border-l-destructive" : n.type === "self_confirmation_reminder" ? "bg-green-50 border-l-4 border-l-primary" : !n.is_read ? "bg-accent/50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {n.type === "late_cancellation" && (
                        <span className="inline-flex items-center rounded-full bg-destructive/20 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">Urgent</span>
                      )}
                      {n.type === "self_confirmation_reminder" && (
                        <span className="inline-flex items-center rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Action Required</span>
                      )}
                      <p className="text-sm font-medium">{n.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                    {n.type === "self_confirmation_reminder" && n.link && (
                      <a href={n.link} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-white bg-primary hover:bg-primary/90 rounded px-2.5 py-1">
                        Confirm Now →
                      </a>
                    )}
                  </div>
                  {!n.is_read && <span className="mt-1 flex-shrink-0 h-2 w-2 rounded-full bg-primary" />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(n.created_at), "MMM d, h:mm a")}</p>
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
