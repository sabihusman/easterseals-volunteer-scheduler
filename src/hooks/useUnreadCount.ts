import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const fetchCount = async () => {
    if (!user) { setCount(0); return; }

    // Single round-trip RPC — previously this hook made one HEAD count
    // request per conversation which flooded the Supabase pooler and
    // routinely hit 503s once a user had a handful of conversations.
    const { data, error } = await (supabase as any).rpc("get_unread_conversation_count");
    if (error) {
      console.warn("useUnreadCount failed:", error);
      return;
    }
    setCount(typeof data === "number" ? data : 0);
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
