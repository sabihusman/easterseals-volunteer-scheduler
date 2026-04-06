import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const fetchCount = async () => {
    if (!user) { setCount(0); return; }

    // Get all conversations the user is part of, with their last_read_at
    const { data: participations } = await (supabase as any)
      .from("conversation_participants")
      .select("conversation_id, last_read_at")
      .eq("user_id", user.id)
      .eq("is_archived", false);

    if (!participations || participations.length === 0) { setCount(0); return; }

    let unread = 0;
    for (const p of participations) {
      const { count: msgCount } = await (supabase as any)
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", p.conversation_id)
        .gt("created_at", p.last_read_at)
        .neq("sender_id", user.id);

      if (msgCount && msgCount > 0) unread++;
    }
    setCount(unread);
  };

  useEffect(() => {
    fetchCount();

    if (!user) return;

    // Subscribe to new messages across all conversations
    const channel = supabase
      .channel("unread-count")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
      }, (payload) => {
        const msg = payload.new as { sender_id: string };
        if (msg.sender_id !== user.id) {
          // Increment optimistically, full recount on next fetch
          setCount((c) => c + 1);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  return { unreadCount: count, refetchUnread: fetchCount };
}
