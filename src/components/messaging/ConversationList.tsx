import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ConversationItem {
  id: string;
  subject: string | null;
  conversation_type: string;
  updated_at: string;
  other_participant_name: string;
  other_participant_id: string;
  last_message: string | null;
  last_message_at: string | null;
  has_unread: boolean;
}

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string, participantNames: Record<string, string>) => void;
  refreshTrigger: number;
}

export function ConversationList({ selectedId, onSelect, refreshTrigger }: ConversationListProps) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchConversations = async () => {
    if (!user) return;

    // Get user's participations
    const { data: myParts } = await (supabase as any)
      .from("conversation_participants")
      .select("conversation_id, last_read_at, is_archived")
      .eq("user_id", user.id)
      .eq("is_archived", false);

    if (!myParts || myParts.length === 0) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const convoIds = myParts.map((p) => p.conversation_id);

    // Get conversations
    const { data: convos } = await (supabase as any)
      .from("conversations")
      .select("*")
      .in("id", convoIds)
      .order("updated_at", { ascending: false });

    if (!convos) { setConversations([]); setLoading(false); return; }

    // Get other participants by looking up message sender IDs
    // (conversation_participants RLS only returns own rows)
    const { data: allMsgs } = await (supabase as any)
      .from("messages")
      .select("conversation_id, sender_id")
      .in("conversation_id", convoIds);

    // Build a map of conversation_id -> other user IDs
    const convoToOthers: Record<string, string> = {};
    const otherUserIds: string[] = [];
    (allMsgs || []).forEach((m: any) => {
      if (m.sender_id !== user.id && !convoToOthers[m.conversation_id]) {
        convoToOthers[m.conversation_id] = m.sender_id;
        if (!otherUserIds.includes(m.sender_id)) otherUserIds.push(m.sender_id);
      }
    });

    // Also check conversations created_by (for convos where the other person sent no messages yet)
    (convos || []).forEach((c: any) => {
      if (c.created_by !== user.id && !otherUserIds.includes(c.created_by)) {
        otherUserIds.push(c.created_by);
        if (!convoToOthers[c.id]) convoToOthers[c.id] = c.created_by;
      }
    });

    const { data: profiles } = otherUserIds.length > 0
      ? await supabase.from("profiles").select("id, full_name, email").in("id", otherUserIds)
      : { data: [] };

    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p) => { profileMap[p.id] = p.full_name || p.email || "Unknown"; });

    // Get latest message per conversation
    const items: ConversationItem[] = [];

    for (const convo of convos) {
      const { data: lastMsg } = await (supabase as any)
        .from("messages")
        .select("content, created_at, sender_id")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const myPart = myParts.find((p) => p.conversation_id === convo.id);
      const otherId = convoToOthers[convo.id] || "";
      const otherName = otherId ? (profileMap[otherId] || "Unknown") : "Unknown";

      const lastMessage = lastMsg?.[0];
      const hasUnread = lastMessage
        ? new Date(lastMessage.created_at) > new Date(myPart?.last_read_at || 0)
          && lastMessage.sender_id !== user.id
        : false;

      items.push({
        id: convo.id,
        subject: convo.subject,
        conversation_type: convo.conversation_type,
        updated_at: convo.updated_at,
        other_participant_name: otherName || "Unknown",
        other_participant_id: otherId,
        last_message: lastMessage?.content?.slice(0, 80) || null,
        last_message_at: lastMessage?.created_at || null,
        has_unread: hasUnread,
      });
    }

    setConversations(items);
    setLoading(false);
  };

  useEffect(() => { fetchConversations(); }, [user, refreshTrigger]);

  const filtered = conversations.filter((c) =>
    !search || c.other_participant_name.toLowerCase().includes(search.toLowerCase())
      || c.subject?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (convo: ConversationItem) => {
    // Build participant names map
    const names: Record<string, string> = {
      [user!.id]: "You",
    };
    // We'll need to fetch full participant list - for now use what we have
    if (convo.other_participant_id) {
      names[convo.other_participant_id] = convo.other_participant_name;
    }
    onSelect(convo.id, names);
  };

  return (
    <div className="flex flex-col h-full border-r">
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 px-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {search ? "No matching conversations" : "No conversations yet"}
            </p>
          </div>
        ) : (
          filtered.map((convo) => (
            <button
              key={convo.id}
              onClick={() => handleSelect(convo)}
              className={`w-full text-left px-4 py-3 border-b transition-colors hover:bg-muted/50 ${
                selectedId === convo.id ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <p className={`text-sm truncate ${convo.has_unread ? "font-bold" : "font-medium"}`}>
                  {convo.other_participant_name}
                </p>
                <div className="flex items-center gap-1.5">
                  {convo.has_unread && (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  )}
                  {convo.last_message_at && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(convo.last_message_at), { addSuffix: false })}
                    </span>
                  )}
                </div>
              </div>
              {convo.subject && (
                <p className="text-xs text-muted-foreground truncate">{convo.subject}</p>
              )}
              {convo.last_message && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {convo.last_message}
                </p>
              )}
            </button>
          ))
        )}
      </ScrollArea>
    </div>
  );
}
