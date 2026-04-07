import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const fetchCount = async () => {
    if (!user) { setCount(0); return; }

    // Get all conversations the user is part of, with their last_read_at
    // and cleared_at (local-delete cutoff).
    const { data: participations } = await (supabase as any)
      .from("conversation_participants")
      .select("conversation_id, last_read_at, cleared_at")
      .eq("user_id", user.id)
      .eq("is_archived", false);

    if (!participations || participations.length === 0) { setCount(0); return; }

    let unread = 0;
    for (const p of participations) {
      // Cutoff: the later of last_read_at and cleared_at. If the user
      // locally deleted the conversation, we shouldn't count anything
      // before the deletion moment.
      const readAt = p.last_read_at ? new Date(p.last_read_at).getTime() : 0;
      const clearedAt = p.cleared_at ? new Date(p.cleared_at).getTime() : 0;
      const cutoff = new Date(Math.max(readAt, clearedAt)).toISOString();

      const { count: msgCount } = await (supabase as any)
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", p.conversation_id)
        .gt("created_at", cutoff)
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
