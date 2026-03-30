import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Users } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { formatSlotRange, slotHours } from "@/lib/slot-utils";

interface Slot {
  id: string;
  slot_start: string;
  slot_end: string;
  total_slots: number;
  booked_slots: number;
}

interface SlotSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: {
    id: string;
    title: string;
    shift_date: string;
    departments?: { name: string } | null;
    status: string;
    total_slots: number;
    booked_slots: number;
  };
  onBooked: () => void;
}

export function SlotSelectionDialog({ open, onOpenChange, shift, onBooked }: SlotSelectionDialogProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSlots([]);
    setLoading(true);
    supabase
      .from("shift_time_slots")
      .select("id, slot_start, slot_end, total_slots, booked_slots")
      .eq("shift_id", shift.id)
      .order("slot_start", { ascending: true })
      .then(({ data, error }) => {
        console.log("Fetched time slots for shift", shift.id, ":", data, error);
        setSlots(data || []);
        setLoading(false);
      });
  }, [open, shift.id]);

  const hasSlots = slots.length > 0;
  const availableSlots = slots.filter(s => s.booked_slots < s.total_slots);
  const allSelected = availableSlots.length > 0 && availableSlots.every(s => selected.has(s.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(availableSlots.map(s => s.id)));
    }
  };

  const toggleSlot = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedSlots = slots.filter(s => selected.has(s.id));
  const totalHours = selectedSlots.reduce((sum, s) => sum + slotHours(s.slot_start, s.slot_end), 0);

  const handleConfirm = async () => {
    if (!user || !profile) return;
    if (hasSlots && selected.size === 0) return;

    // Check booking window
    const shiftDate = new Date(shift.shift_date + "T00:00:00");
    const now = new Date();
    const daysAhead = Math.ceil((shiftDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const maxDays = profile.extended_booking ? 21 : 14;
    if (daysAhead > maxDays) {
      toast({ title: "Booking window exceeded", description: `You can book up to ${maxDays} days in advance.`, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const isFull = shift.booked_slots >= shift.total_slots;

    // Insert booking
    const { data: booking, error } = await supabase
      .from("shift_bookings")
      .insert({
        shift_id: shift.id,
        volunteer_id: user.id,
        booking_status: isFull ? "waitlisted" : "confirmed",
      })
      .select("id")
      .single();

    if (error || !booking) {
      toast({ title: "Error", description: error?.message || "Failed to book", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Insert slot selections if slots exist
    if (hasSlots && selected.size > 0) {
      const slotRows = Array.from(selected).map(slotId => ({
        booking_id: booking.id,
        slot_id: slotId,
      }));
      const { error: slotError } = await supabase.from("shift_booking_slots").insert(slotRows);

      if (slotError) {
        toast({ title: "Error saving slot selections", description: slotError.message, variant: "destructive" });
        setSubmitting(false);
        return;
      }
    }

    toast({ title: isFull ? "Added to waitlist" : "Shift booked!", description: hasSlots ? `${totalHours} hours selected` : "Booking confirmed" });
    onBooked();
    setSubmitting(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book Shift</DialogTitle>
        </DialogHeader>

        {/* Shift details */}
        <div className="space-y-1 pb-2 border-b">
          <div className="font-medium">{shift.title}</div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(shift.shift_date + "T00:00:00"), "MMM d, yyyy")}
            </span>
            {shift.departments?.name && (
              <Badge variant="secondary" className="text-xs">{shift.departments.name}</Badge>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading time slots...</p>
        ) : !hasSlots ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">This shift has no individual time slots. You'll be booked for the full shift.</p>
            <Button onClick={handleConfirm} disabled={submitting} className="w-full">
              {submitting ? "Booking..." : "Confirm Booking"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Select Your Hours</h4>

              {/* Full shift option */}
              {availableSlots.length > 1 && (
                <div
                  className={`flex items-center gap-3 p-3 rounded-md border mb-2 cursor-pointer transition-colors ${allSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  onClick={toggleAll}
                >
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Full Shift</div>
                    <div className="text-xs text-muted-foreground">
                      {formatSlotRange(slots[0].slot_start, slots[slots.length - 1].slot_end)} — {slots.reduce((s, sl) => s + slotHours(sl.slot_start, sl.slot_end), 0)} hours
                    </div>
                  </div>
                </div>
              )}

              {/* Individual slots */}
              <div className="space-y-1.5">
                {slots.map(slot => {
                  const isFull = slot.booked_slots >= slot.total_slots;
                  const isSelected = selected.has(slot.id);
                  const remaining = slot.total_slots - slot.booked_slots;
                  return (
                    <div
                      key={slot.id}
                      className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${
                        isFull ? "opacity-50 cursor-not-allowed bg-muted" : isSelected ? "border-primary bg-primary/5 cursor-pointer" : "hover:bg-muted/50 cursor-pointer"
                      }`}
                      onClick={() => !isFull && toggleSlot(slot.id)}
                    >
                      <Checkbox checked={isSelected} disabled={isFull} onCheckedChange={() => !isFull && toggleSlot(slot.id)} />
                      <div className="flex-1">
                        <div className="text-sm">{formatSlotRange(slot.slot_start, slot.slot_end)}</div>
                        <div className="text-xs text-muted-foreground">{slotHours(slot.slot_start, slot.slot_end)} hours</div>
                      </div>
                      <div className="text-xs">
                        {isFull ? (
                          <Badge variant="secondary" className="text-[10px]">Full</Badge>
                        ) : (
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" />{remaining} left
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            {selected.size > 0 && (
              <div className="bg-muted rounded-md p-3 text-sm space-y-1">
                <div className="font-medium">Booking Summary</div>
                <div className="text-muted-foreground">
                  {selectedSlots.map(s => formatSlotRange(s.slot_start, s.slot_end)).join(", ")}
                </div>
                <div className="font-medium">Selected: {totalHours} hours</div>
              </div>
            )}

            <Button onClick={handleConfirm} disabled={submitting || selected.size === 0} className="w-full">
              {submitting ? "Booking..." : selected.size === 0 ? "Select at least one slot" : "Confirm Booking"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
