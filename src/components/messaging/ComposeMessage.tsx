import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { MESSAGING_ENABLED } from "@/config/featureFlags";

interface User {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface ComposeMessageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (conversationId: string) => void;
}

export function ComposeMessage({ open, onOpenChange, onSent }: ComposeMessageProps) {
  const { user, role, profile } = useAuth();
  const messagingBlocked = (profile as any)?.messaging_blocked === true;
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!open) return;
    const fetchUsers = async () => {
      // Volunteers can message coordinators/admins; coordinators/admins can message anyone
      let query = supabase.from("profiles").select("id, full_name, email, role").order("full_name");
      if (role === "volunteer") {
        query = query.in("role", ["coordinator", "admin"]);
      }
      const { data } = await query;
      if (data) setUsers((data as User[]).filter((u) => u.id !== user?.id));
    };
    fetchUsers();
  }, [open, user, role]);

  const resetForm = () => {
    setSelectedUserId(""); setSubject(""); setContent(""); setSearchTerm("");
  };

  const handleSend = async () => {
    if (!selectedUserId || !content.trim() || !user) return;
    setSending(true);

    // Check for existing direct conversation
    const { data: myConvos } = await (supabase as any)
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    const { data: theirConvos } = await (supabase as any)
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", selectedUserId);

    const myIds = new Set<string>(
      (myConvos || []).map((c: { conversation_id: string }) => c.conversation_id)
    );
    const sharedIds = (theirConvos || [])
      .filter((c: { conversation_id: string }) => myIds.has(c.conversation_id))
      .map((c: { conversation_id: string }) => c.conversation_id);

    let conversationId: string | null = null;

    if (sharedIds.length > 0) {
      // Check if any shared conversation is a direct conversation
      const { data: directConvos } = await (supabase as any)
        .from("conversations")
        .select("id")
        .in("id", sharedIds)
        .eq("conversation_type", "direct");

      if (directConvos && directConvos.length > 0) {
        conversationId = directConvos[0].id;
      }
    }

    if (!conversationId) {
      // Create new conversation
      const { data: newConvo, error: convoError } = await (supabase as any)
        .from("conversations")
        .insert({
          subject: subject.trim() || null,
          conversation_type: "direct",
          created_by: user.id,
        })
        .select()
        .single();

      if (convoError || !newConvo) {
        toast({ variant: "destructive", title: "Error", description: convoError?.message || "Failed to create conversation" });
        setSending(false);
        return;
      }

      conversationId = newConvo.id;

      // Add participants
      await (supabase as any).from("conversation_participants").insert([
        { conversation_id: conversationId, user_id: user.id },
        { conversation_id: conversationId, user_id: selectedUserId },
      ]);
    }

    // Send message
    const { error: msgError } = await (supabase as any).from("messages").insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim(),
    });

    // Update conversation timestamp
    await (supabase as any)
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    // Send notification.
    // NOTE: `users` is filtered to exclude the current user (line 49),
    // so the previous `users.find(u => u.id === user.id)` always failed
    // and every compose-notification said "Someone". Pull the sender's
    // name directly from their own profile via useAuth instead.
    //
    // Pilot dark-launch (see src/config/featureFlags.ts): the
    // messaging UI is unreachable when MESSAGING_ENABLED is false,
    // so this code path doesn't run anyway — but gating the fan-out
    // here too prevents stray dead-link notifications if a deep
    // import or test happens to call this component.
    if (MESSAGING_ENABLED) {
      const senderName = profile?.full_name || user.email || "Someone";
      await supabase.from("notifications").insert({
        user_id: selectedUserId,
        title: `New message from ${senderName || "a user"}`,
        message: content.trim().slice(0, 100),
        type: "new_message",
        link: "/messages",
        is_read: false,
      });
    }

    setSending(false);

    if (msgError) {
      toast({ variant: "destructive", title: "Error", description: msgError.message });
    } else {
      toast({ title: "Message sent" });
      resetForm();
      onOpenChange(false);
      onSent(conversationId!);
    }
  };

  const filteredUsers = users.filter((u) =>
    !searchTerm ||
    u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>To</Label>
            <Input
              placeholder="Search for a user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && filteredUsers.length > 0 && !selectedUserId && (
              <div className="border rounded-md max-h-32 overflow-y-auto">
                {filteredUsers.slice(0, 8).map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedUserId(u.id); setSearchTerm(u.full_name || u.email); }}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                  >
                    <span className="font-medium">{u.full_name || "—"}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{u.email}</span>
                    <span className="text-muted-foreground ml-2 text-xs capitalize">({u.role})</span>
                  </button>
                ))}
              </div>
            )}
            {selectedUserId && (
              <p className="text-xs text-primary">
                Selected: {users.find((u) => u.id === selectedUserId)?.full_name || users.find((u) => u.id === selectedUserId)?.email}
                <button className="ml-2 text-destructive" onClick={() => { setSelectedUserId(""); setSearchTerm(""); }}>Clear</button>
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Subject (optional)</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type your message..." rows={4} />
          </div>
        </div>
        {messagingBlocked && (
          <p className="text-xs text-destructive">
            Messaging has been disabled for your account. You cannot send new messages.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={!selectedUserId || !content.trim() || sending || messagingBlocked}
          >
            {sending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
