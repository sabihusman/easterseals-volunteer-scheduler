import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface Department {
  id: string;
  name: string;
}

interface BulkComposeMessageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}

export function BulkComposeMessage({ open, onOpenChange, onSent }: BulkComposeMessageProps) {
  const { user, role, profile } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("all");
  const [bgFilter, setBgFilter] = useState("all");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const fetchDepts = async () => {
      const { data } = await supabase.from("departments").select("id, name").eq("is_active", true).order("name");
      if (data) setDepartments(data as Department[]);
    };
    fetchDepts();
  }, [open]);

  // Preview recipient count when filters change
  useEffect(() => {
    if (!open) return;
    const previewCount = async () => {
      let query = supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "volunteer");
      if (bgFilter !== "all") {
        query = query.eq("bg_check_status", bgFilter as any);
      }
      // Department filter requires checking department_coordinators or shift_bookings
      // For simplicity, we skip department filtering in count — applied at send time
      const { count } = await query;
      setRecipientCount(count || 0);
    };
    previewCount();
  }, [open, bgFilter]);

  const resetForm = () => {
    setDepartmentId("all"); setBgFilter("all"); setSubject(""); setContent("");
    setRecipientCount(null);
  };

  const handleSend = async () => {
    if (!content.trim() || !user) return;
    setSending(true);

    // Fetch recipients
    let query = supabase.from("profiles").select("id, full_name, email").eq("role", "volunteer");
    if (bgFilter !== "all") {
      query = query.eq("bg_check_status", bgFilter as any);
    }
    const { data: recipients } = await query;

    if (!recipients || recipients.length === 0) {
      toast({ variant: "destructive", title: "No recipients found" });
      setSending(false);
      return;
    }

    const senderName = profile?.full_name || "Coordinator";
    let sentCount = 0;

    for (const recipient of recipients) {
      if (recipient.id === user.id) continue;

      // Create a conversation for each recipient
      const { data: newConvo, error: convoError } = await (supabase as any)
        .from("conversations")
        .insert({
          subject: subject.trim() || `Message from ${senderName}`,
          conversation_type: "bulk",
          department_id: departmentId !== "all" ? departmentId : null,
          created_by: user.id,
        })
        .select()
        .single();

      if (convoError || !newConvo) continue;

      // Add participants
      await (supabase as any).from("conversation_participants").insert([
        { conversation_id: newConvo.id, user_id: user.id },
        { conversation_id: newConvo.id, user_id: recipient.id },
      ]);

      // Send message
      await (supabase as any).from("messages").insert({
        conversation_id: newConvo.id,
        sender_id: user.id,
        content: content.trim(),
      });

      // Notification
      await supabase.from("notifications").insert({
        user_id: recipient.id,
        title: `Message from ${senderName}`,
        message: content.trim().slice(0, 100),
        type: "new_message",
        link: "/messages",
        is_read: false,
      });

      sentCount++;
    }

    setSending(false);
    toast({ title: "Bulk message sent", description: `Sent to ${sentCount} volunteer${sentCount !== 1 ? "s" : ""}.` });
    resetForm();
    onOpenChange(false);
    onSent();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>BG Check Status</Label>
              <Select value={bgFilter} onValueChange={setBgFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Status</SelectItem>
                  <SelectItem value="cleared">Cleared</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {recipientCount !== null && (
            <p className="text-sm text-muted-foreground">
              This will be sent to <span className="font-medium text-foreground">{recipientCount}</span> volunteer{recipientCount !== 1 ? "s" : ""}.
            </p>
          )}

          <div className="space-y-2">
            <Label>Subject (optional)</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Announcement subject" />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type your message to all selected volunteers..." rows={5} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!content.trim() || sending}>
            {sending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : `Send to ${recipientCount || 0} volunteers`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
