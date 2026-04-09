import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  // Track the active channel in a ref so we can guarantee single-instance
  // cleanup even when React strict mode double-invokes the effect or when
  // the user object identity changes mid-render.
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchCount = useCallback(async () => {
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
  }, [user]);

  useEffect(() => {
    fetchCount();

    if (!user) {
      // Make absolutely sure we tear down any leftover subscription when
      // the user logs out.
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    // Defensive teardown: if a channel from a previous render is still
    // around (StrictMode double-mount, React Fast Refresh, user identity
    // change), remove it before creating a new one. Without this, multiple
    // listeners stack up on the same socket and every incoming message
    // increments `count` once per stacked subscription.
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Per-user channel name so two parallel mounts (e.g. NotificationBell +
    // a future inbox tab on the same page) cannot collide on a shared
    // channel name and silently drop one of the listeners.
    const channelName = `unread-count:${user.id}`;
    const channel = supabase
      .channel(channelName)
      // A new incoming message from someone else → refetch authoritative
      // count from the RPC. Previously this hook incremented a local
      // counter, which was only correct on INSERTs and never decremented.
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
      }, (payload) => {
        const msg = payload.new as { sender_id: string };
        if (msg.sender_id !== user.id) {
          fetchCount();
        }
      })
      // The user marked a conversation as read (ConversationThread.markRead
      // bumps last_read_at on their own participant row). Without this
      // the badge count was "sticky" — it only ever went up, never down,
      // until a full page reload.
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "conversation_participants",
        filter: `user_id=eq.${user.id}`,
      }, () => {
        fetchCount();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, fetchCount]);

  return { unreadCount: count, refetchUnread: fetchCount };
}
