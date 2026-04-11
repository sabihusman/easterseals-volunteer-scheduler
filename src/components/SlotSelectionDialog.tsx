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
import { WeatherForecast } from "@/components/WeatherForecast";
import { sendEmail } from "@/lib/email-utils";
import { getShiftTimes, timeLabel } from "@/lib/calendar-utils";

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
    department_id?: string;
    departments?: { name: string; requires_bg_check?: boolean } | null;
    status: string;
    total_slots: number;
    booked_slots: number;
    time_type: string;
    start_time?: string | null;
    end_time?: string | null;
  };
  /** Slot IDs already booked by the current volunteer (pre-disabled) */
  bookedSlotIds?: Set<string>;
  onBooked: () => void;
}

export function SlotSelectionDialog({ open, onOpenChange, shift, bookedSlotIds, onBooked }: SlotSelectionDialogProps) {
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
        setSlots(data || []);
        setLoading(false);
      });
  }, [open, shift.id]);

  // Slots that are selectable (not already booked by this volunteer)
  const selectableSlots = slots.filter(s => !bookedSlotIds?.has(s.id));
  const availableSlots = selectableSlots.filter(s => s.booked_slots < s.total_slots);
  // "Full Shift" is only valid when ALL selectable slots are available (none full)
  const canSelectFullShift = selectableSlots.length > 1 && selectableSlots.every(s => s.booked_slots < s.total_slots);
  // "Full Shift" is checked only when every selectable slot is selected
  const allSelected = canSelectFullShift && selectableSlots.length > 0 && selectableSlots.every(s => selected.has(s.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      // Select all selectable (available) slots
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

  const handleBookingError = (msg: string) => {
    if (msg.includes("overlaps with this shift time")) {
      toast({ title: "Time conflict", description: "You already have a shift booked that overlaps with this time. Please check My Shifts before booking.", variant: "destructive" });
    } else if (msg.includes("background check") || msg.includes("bg_check")) {
      const status = profile?.bg_check_status || "pending";
      toast({ title: "Background check required", description: `This shift requires a cleared background check. Your current status is: ${status}. Please contact your coordinator to update your status.`, variant: "destructive" });
    } else if (msg.includes("restrict") || msg.includes("department")) {
      toast({ title: "Unable to book", description: "You are not currently able to book shifts in this department. Please contact your coordinator if you believe this is an error.", variant: "destructive" });
    } else {
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const missingEmergencyContact =
    !(profile as any)?.emergency_contact_name ||
    !(profile as any)?.emergency_contact_phone;

  const handleConfirm = async () => {
    if (!user || !profile) return;
    if (selected.size === 0) return;

    if (missingEmergencyContact) {
      toast({
        title: "Emergency contact required",
        description: "Please add an emergency contact in your profile settings before booking.",
        variant: "destructive",
      });
      return;
    }

    // Reject booking if shift has already ended
    const shiftEndStr =
      shift.end_time ||
      (shift.time_type === "morning"
        ? "12:00:00"
        : shift.time_type === "afternoon"
        ? "16:00:00"
        : "17:00:00");
    const shiftEnd = new Date(`${shift.shift_date}T${shiftEndStr}`);
    const now = new Date();
    if (shiftEnd <= now) {
      toast({
        title: "Shift has ended",
        description: "This shift is no longer available to book.",
        variant: "destructive",
      });
      onOpenChange(false);
      return;
    }

    // Booking window check
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shiftDate = new Date(shift.shift_date + "T00:00:00");
    const daysAhead = Math.round((shiftDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const maxDays = profile.extended_booking ? 21 : 14;
    if (daysAhead > maxDays) {
      toast({ title: "Booking window exceeded", description: `You can book up to ${maxDays} days in advance.`, variant: "destructive" });
      return;
    }

    setSubmitting(true);

    // Fresh per-slot capacity check
    const { data: freshSlots } = await supabase
      .from("shift_time_slots")
      .select("id, total_slots, booked_slots")
      .in("id", Array.from(selected));

    const slotMap = new Map((freshSlots || []).map(s => [s.id, s]));

    // Separate selected slots into available vs full
    const confirmedSlotIds: string[] = [];
    const waitlistedSlotIds: string[] = [];
    for (const slotId of selected) {
      const s = slotMap.get(slotId);
      if (s && s.booked_slots >= s.total_slots) {
        waitlistedSlotIds.push(slotId);
      } else {
        confirmedSlotIds.push(slotId);
      }
    }

    // If ALL selected slots are full, ask user to confirm waitlist
    if (confirmedSlotIds.length === 0 && waitlistedSlotIds.length > 0) {
      const ok = window.confirm(
        "All selected slots are full. Would you like to join the waitlist? You'll be notified if a spot opens up."
      );
      if (!ok) {
        setSubmitting(false);
        return;
      }
    }

    // Insert one shift_bookings row per selected slot
    let successCount = 0;
    let errorMsg = "";
    for (const slotId of [...confirmedSlotIds, ...waitlistedSlotIds]) {
      const isFull = waitlistedSlotIds.includes(slotId);

      // Check for existing cancelled booking on this slot to reactivate
      const { data: existing } = await supabase
        .from("shift_bookings")
        .select("id, booking_status")
        .eq("shift_id", shift.id)
        .eq("volunteer_id", user.id)
        .eq("time_slot_id", slotId)
        .maybeSingle();

      if (existing && (existing.booking_status === "confirmed" || existing.booking_status === "waitlisted")) {
        // Already booked this slot — skip
        continue;
      }

      if (existing && existing.booking_status === "cancelled") {
        // Reactivate cancelled booking
        const { error } = await supabase
          .from("shift_bookings")
          .update({
            booking_status: isFull ? "waitlisted" : "confirmed",
            confirmation_status: "pending_confirmation" as const,
            cancelled_at: null,
          })
          .eq("id", existing.id);
        if (error) {
          errorMsg = error.message;
          continue;
        }
      } else {
        // Insert new booking
        const { error } = await supabase
          .from("shift_bookings")
          .insert({
            shift_id: shift.id,
            volunteer_id: user.id,
            booking_status: isFull ? "waitlisted" : "confirmed",
            time_slot_id: slotId,
          });
        if (error) {
          errorMsg = error.message;
          continue;
        }
      }
      successCount++;
    }

    if (successCount === 0 && errorMsg) {
      handleBookingError(errorMsg);
      setSubmitting(false);
      return;
    }

    const anyWaitlisted = waitlistedSlotIds.length > 0;
    toast({
      title: anyWaitlisted && confirmedSlotIds.length === 0
        ? "Added to waitlist"
        : anyWaitlisted
        ? "Partially booked"
        : "Shift booked!",
      description: anyWaitlisted && confirmedSlotIds.length === 0
        ? "All selected slots are full. You'll be notified if a spot opens up."
        : anyWaitlisted
        ? `${confirmedSlotIds.length} slot(s) confirmed, ${waitlistedSlotIds.length} waitlisted.`
        : `${totalHours} hours selected`,
    });

    // Fire and forget booking confirmation email
    if (profile?.email) {
      const slotSummary = selectedSlots.map(s => formatSlotRange(s.slot_start, s.slot_end)).join(", ");
      sendEmail({
        to: profile.email,
        type: "shift_booked",
        shiftTitle: shift.title,
        shiftDate: format(new Date(shift.shift_date + "T00:00:00"), "MMMM d, yyyy"),
        shiftTime: timeLabel(shift),
        department: shift.departments?.name || "",
        selectedSlots: slotSummary || undefined,
      }).catch(console.error);
    }

    onBooked();
    setSubmitting(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85dvh]">
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

        {/* Emergency contact gate */}
        {missingEmergencyContact && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <p className="font-medium text-foreground">Emergency contact required</p>
            <p className="text-muted-foreground text-xs mt-1">
              You must add an emergency contact before booking.{" "}
              <a href="/settings" className="text-primary underline" onClick={() => onOpenChange(false)}>
                Go to Settings →
              </a>
            </p>
          </div>
        )}

        {/* Weather forecast for outdoor departments */}
        {shift.departments && shift.departments.requires_bg_check === false && (
          <WeatherForecast shiftDate={shift.shift_date} />
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading time slots...</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time slots available for this shift.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Select Your Hours</h4>

              {/* Full shift option — only show if all selectable slots are available */}
              {canSelectFullShift && (
                <div
                  className={`flex items-center gap-3 p-3 rounded-md border mb-2 cursor-pointer transition-colors ${allSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  onClick={toggleAll}
                >
                  <Checkbox checked={allSelected} tabIndex={-1} aria-hidden="true" />
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
                  const isBooked = bookedSlotIds?.has(slot.id) ?? false;
                  const isSelected = selected.has(slot.id);
                  const remaining = slot.total_slots - slot.booked_slots;
                  return (
                    <div
                      key={slot.id}
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-disabled={isBooked}
                      tabIndex={isBooked ? -1 : 0}
                      className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${
                        isBooked
                          ? "opacity-50 cursor-not-allowed bg-muted/30"
                          : isSelected
                          ? isFull
                            ? "border-warning bg-warning/5 cursor-pointer"
                            : "border-primary bg-primary/5 cursor-pointer"
                          : "hover:bg-muted/50 cursor-pointer"
                      }`}
                      onClick={() => !isBooked && toggleSlot(slot.id)}
                      onKeyDown={(e) => {
                        if (!isBooked && (e.key === " " || e.key === "Enter")) {
                          e.preventDefault();
                          toggleSlot(slot.id);
                        }
                      }}
                    >
                      <Checkbox checked={isSelected || isBooked} disabled={isBooked} tabIndex={-1} aria-hidden="true" />
                      <div className="flex-1">
                        <div className="text-sm">{formatSlotRange(slot.slot_start, slot.slot_end)}</div>
                        <div className="text-xs text-muted-foreground">{slotHours(slot.slot_start, slot.slot_end)} hours</div>
                      </div>
                      <div className="text-xs">
                        {isBooked ? (
                          <Badge variant="secondary" className="text-[10px]">Booked</Badge>
                        ) : isFull ? (
                          <Badge variant="outline" className="text-[10px] border-warning text-warning">Full — Waitlist</Badge>
                        ) : (
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" />{remaining}/{slot.total_slots}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            {selected.size > 0 && (() => {
              const anySelectedFull = selectedSlots.some(
                s => s.booked_slots >= s.total_slots
              );
              return (
                <div className={`rounded-md p-3 text-sm space-y-1 ${anySelectedFull ? "bg-warning/10 border border-warning/30" : "bg-muted"}`}>
                  <div className="font-medium">
                    {anySelectedFull ? "Waitlist Summary" : "Booking Summary"}
                  </div>
                  <div className="text-muted-foreground">
                    {selectedSlots.map(s => formatSlotRange(s.slot_start, s.slot_end)).join(", ")}
                  </div>
                  <div className="font-medium">Selected: {totalHours} hours</div>
                  {anySelectedFull && (
                    <p className="text-xs text-warning">
                      One or more selected slots are full. You'll be added to the waitlist and notified if a spot opens up.
                    </p>
                  )}
                </div>
              );
            })()}

            <Button
              onClick={handleConfirm}
              disabled={submitting || selected.size === 0}
              className="w-full"
            >
              {submitting
                ? "Booking..."
                : selected.size === 0
                ? "Select your preferred hours"
                : selectedSlots.some(s => s.booked_slots >= s.total_slots)
                ? "Join Waitlist"
                : "Confirm Booking"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
