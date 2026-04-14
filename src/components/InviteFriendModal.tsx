import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be under 100 characters"),
  email: z.string().trim().email("Invalid email address").max(255, "Email must be under 255 characters"),
});

interface InviteFriendModalProps {
  shiftId: string;
  shiftTitle: string;
  shiftDate?: string;
  shiftTime?: string;
}

export function InviteFriendModal({ shiftId, shiftTitle, shiftDate, shiftTime }: InviteFriendModalProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async () => {
    if (!user) return;
    const result = inviteSchema.safeParse({ name, email });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((e) => { fieldErrors[e.path[0] as string] = e.message; });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    const { error } = await supabase.from("shift_invitations").insert({
      shift_id: shiftId,
      invited_by: user.id,
      invite_email: result.data.email,
      invite_name: result.data.name,
    });

    setSubmitting(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Invite sent to ${result.data.name}!` });

      // Fire-and-forget email
      const volunteerName = profile?.full_name || "A volunteer";
      const inviteName = result.data.name;
      const inviteEmail = result.data.email;
      supabase.functions.invoke("send-email", {
        body: {
          to: inviteEmail,
          subject: `${volunteerName} invited you to volunteer at Easterseals Iowa!`,
          html: `
            <div style="font-family: Arial; max-width: 600px;">
              <div style="background: #006B3E; padding: 20px; color: white; text-align: center;">
                <h1>Easterseals Iowa</h1>
                <p>Volunteer Invitation</p>
              </div>
              <div style="padding: 30px;">
                <p>Hi ${inviteName},</p>
                <p><strong>${volunteerName}</strong> has invited you to join them for a volunteer shift at Easterseals Iowa!</p>
                <h3>${shiftTitle}</h3>
                ${shiftDate ? `<p>📅 ${shiftDate}</p>` : ""}
                ${shiftTime ? `<p>🕐 ${shiftTime}</p>` : ""}
                <p>📍 Grounds & Facilities — Johnston, IA</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://easterseals-volunteer-scheduler.vercel.app/auth" data-resend-track="false" style="background: #006B3E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px;">
                    Sign Up &amp; Join the Shift
                  </a>
                  <p style="margin-top: 12px; font-size: 12px; color: #666;">Or visit: https://easterseals-volunteer-scheduler.vercel.app/auth</p>
                </div>
                <p style="color: #666; font-size: 12px;">This invitation expires in 7 days.</p>
              </div>
            </div>
          `,
          type: "friend_invite",
        },
      }).catch((err) => console.log("Invite email failed:", err));

      setName("");
      setEmail("");
      setErrors({});
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs h-7">
          <UserPlus className="h-3 w-3 mr-1" />Invite a Friend
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a Friend to {shiftTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-name">Friend's Name</Label>
            <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" maxLength={100} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">Friend's Email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" maxLength={255} />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? "Sending..." : "Send Invite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
