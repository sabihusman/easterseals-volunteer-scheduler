import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { Send, Loader2 } from "lucide-react";

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender_name?: string;
}

interface ConversationThreadProps {
  conversationId: string;
  participantNames: Record<string, string>;
  onMessageSent?: () => void;
}

export function ConversationThread({ conversationId, participantNames: externalNames, onMessageSent }: ConversationThreadProps) {
  const { user, profile } = useAuth();
  const messagingBlocked = (profile as any)?.messaging_blocked === true;
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  // scrollRef was previously attached to <ScrollArea> but shadcn's
  // ScrollArea (Radix) renders a nested viewport div — scrollTop on
  // the outer wrapper is a no-op. A sentinel div at the bottom of
  // the message list + scrollIntoView() is the reliable pattern.
  const bottomRef = useRef<HTMLDivElement>(null);
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});

  // Fetch participant names by looking up sender IDs from messages
  // (avoids RLS issue where conversation_participants only returns own row)
  const fetchParticipantNames = async () => {
    if (!user) return;
    const names: Record<string, string> = { [user.id]: profile?.full_name || "You" };

    // Get all unique sender IDs from messages in this conversation
    const { data: msgs } = await (supabase as any)
      .from("messages")
      .select("sender_id")
      .eq("conversation_id", conversationId);

    if (msgs) {
      const otherIds = [...new Set<string>(
        (msgs as any[]).map((m: any) => m.sender_id).filter((id: string) => id !== user.id)
      )];
      if (otherIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", otherIds);
        (profiles || []).forEach((p) => { names[p.id] = p.full_name || p.email || "Unknown"; });
      }
    }
    setResolvedNames(names);
  };

  // Use external names if provided, otherwise fetch
  const participantNames = Object.keys(externalNames).length > 1 ? externalNames : resolvedNames;

  const fetchMessages = async () => {
    if (!user) return;
    // Respect this user's local deletion cutoff — only show messages newer than cleared_at
    const { data: myPart } = await (supabase as any)
      .from("conversation_participants")
      .select("cleared_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    let query = (supabase as any)
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (myPart?.cleared_at) query = query.gt("created_at", myPart.cleared_at);

    const { data } = await query;
    if (data) setMessages(data as Message[]);
    setLoading(false);
  };

  // Mark conversation as read
  const markRead = async () => {
    if (!user) return;
    await (supabase as any)
      .from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id);
  };

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    fetchMessages();
    fetchParticipantNames();
    markRead();

    // Real-time subscription
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const msg = payload.new as Message;
        setMessages((prev) => [...prev, msg]);
        // Mark read if we're viewing this conversation
        markRead();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  // Auto-scroll to bottom on new messages. Uses a sentinel div
  // at the bottom of the list + scrollIntoView so it works
  // regardless of the ScrollArea viewport nesting.
  useEffect(() => {
    // Small delay lets the DOM render the new message before scrolling
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !user) return;
    setSending(true);

    const { error } = await (supabase as any).from("messages").insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: newMessage.trim(),
    });

    if (!error) {
      // Update conversation updated_at
      await (supabase as any)
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      setNewMessage("");
      onMessageSent?.();

      // Insert notification for other participants
      const otherParticipants = Object.keys(participantNames).filter((id) => id !== user.id);
      if (otherParticipants.length > 0) {
        const senderName = participantNames[user.id] || "Someone";
        const notifs = otherParticipants.map((uid) => ({
          user_id: uid,
          title: `New message from ${senderName}`,
          message: newMessage.trim().slice(0, 100),
          type: "new_message",
          link: `/messages`,
          is_read: false,
        }));
        await supabase.from("notifications").insert(notifs);
      }
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading messages...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-8">
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              content={msg.content}
              senderName={participantNames[msg.sender_id] || "Unknown"}
              createdAt={msg.created_at}
              isOwn={msg.sender_id === user?.id}
            />
          ))
        )}
        {/* Sentinel element — scrollIntoView target for auto-scroll */}
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Compose */}
      <div className="border-t p-3 flex gap-2">
        <Textarea
          placeholder={messagingBlocked ? "Messaging has been disabled by an admin." : "Type a message..."}
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={messagingBlocked}
          className="resize-none min-h-[40px] max-h-[120px]"
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!newMessage.trim() || sending || messagingBlocked}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
