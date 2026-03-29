import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShieldX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  volunteerId: string;
  volunteerName: string;
  departmentId: string;
  departmentName: string;
  onDone: () => void;
}

export function RestrictVolunteerModal({ volunteerId, volunteerName, departmentId, departmentName, onDone }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user) return;
    setSubmitting(true);
    const { error } = await supabase.from("department_restrictions").insert({
      department_id: departmentId,
      volunteer_id: volunteerId,
      restricted_by: user.id,
      reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${volunteerName} restricted from ${departmentName}` });
      setReason("");
      setOpen(false);
      onDone();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs h-7 text-destructive">
          <ShieldX className="h-3 w-3 mr-1" />Restrict
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restrict {volunteerName} from {departmentName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Enter reason for restriction..." rows={3} />
          </div>
          <Button onClick={handleSubmit} disabled={submitting} variant="destructive" className="w-full">
            {submitting ? "Restricting..." : "Confirm Restriction"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
