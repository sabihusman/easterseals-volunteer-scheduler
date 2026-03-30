import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShieldX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

const restrictSchema = z.object({
  reason: z.string().max(500, "Reason must be under 500 characters").optional(),
});

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
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!user) return;
    const result = restrictSchema.safeParse({ reason: reason.trim() || undefined });
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }
    setError("");
    setSubmitting(true);
    const { error: dbError } = await supabase.from("department_restrictions").insert({
      department_id: departmentId,
      volunteer_id: volunteerId,
      restricted_by: user.id,
      reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (dbError) {
      toast({ title: "Error", description: dbError.message, variant: "destructive" });
    } else {
      toast({ title: `${volunteerName} restricted from ${departmentName}` });
      setReason("");
      setError("");
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
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Enter reason for restriction..." rows={3} maxLength={500} />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">{reason.length}/500</p>
          </div>
          <Button onClick={handleSubmit} disabled={submitting} variant="destructive" className="w-full">
            {submitting ? "Restricting..." : "Confirm Restriction"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
