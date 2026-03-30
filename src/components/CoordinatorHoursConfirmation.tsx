import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Save, AlertTriangle, CheckCircle } from "lucide-react";

interface Props {
  booking: any;
  onUpdate: (bookingId: string, hours: number) => void;
}

export function CoordinatorHoursConfirmation({ booking, onUpdate }: Props) {
  const { toast } = useToast();
  const [hours, setHours] = useState(booking.coordinator_reported_hours?.toString() || "");
  const [saving, setSaving] = useState(false);

  const volHours = booking.volunteer_reported_hours;
  const coordHours = booking.coordinator_reported_hours;
  const discrepancy = volHours != null && coordHours != null ? Math.abs(volHours - coordHours) : null;

  const handleSave = async () => {
    const h = parseFloat(hours);
    if (isNaN(h) || h < 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("shift_bookings")
      .update({ coordinator_reported_hours: h })
      .eq("id", booking.id);

    if (!error) {
      await supabase.rpc("resolve_hours_discrepancy", { p_booking_id: booking.id });
      onUpdate(booking.id, h);
      toast({ title: "Hours recorded" });
    } else {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-1.5 mt-2 p-2 rounded bg-background border">
      {volHours != null && (
        <div className="text-xs text-muted-foreground">
          Volunteer reported: <span className="font-medium">{volHours}h</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="0.5"
          min="0"
          className="w-20 h-7 text-xs"
          placeholder="Hours"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
          <Save className="h-3 w-3 mr-1" />Save
        </Button>
      </div>
      {discrepancy != null && discrepancy > 2 && (
        <Badge variant="secondary" className="text-xs bg-warning/20 text-warning-foreground">
          <AlertTriangle className="h-3 w-3 mr-1" />Hours discrepancy — coordinator hours recorded
        </Badge>
      )}
      {discrepancy != null && discrepancy <= 2 && (
        <Badge variant="secondary" className="text-xs bg-success/20 text-success-foreground">
          <CheckCircle className="h-3 w-3 mr-1" />Volunteer hours accepted
        </Badge>
      )}
    </div>
  );
}
