import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatSlotRange } from "@/lib/slot-utils";
import { Users, Clock } from "lucide-react";

interface Props {
  shiftId: string;
  /** The shift's capacity per slot */
  totalSlots: number;
}

interface SlotInfo {
  id: string;
  slot_start: string;
  slot_end: string;
  total_slots: number;
  booked_slots: number;
}

interface BookingInfo {
  id: string;
  time_slot_id: string | null;
  booking_status: string;
  volunteer_id: string;
  profiles: { full_name: string } | null;
}

export function ShiftSlotTimeline({ shiftId, totalSlots }: Props) {
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [bookings, setBookings] = useState<BookingInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase
        .from("shift_time_slots")
        .select("id, slot_start, slot_end, total_slots, booked_slots")
        .eq("shift_id", shiftId)
        .order("slot_start"),
      supabase
        .from("shift_bookings")
        .select("id, time_slot_id, booking_status, volunteer_id, profiles(full_name)")
        .eq("shift_id", shiftId)
        .in("booking_status", ["confirmed", "waitlisted"]),
    ]).then(([{ data: slotData }, { data: bookingData }]) => {
      setSlots((slotData || []) as SlotInfo[]);
      setBookings((bookingData || []) as BookingInfo[]);
      setLoading(false);
    });
  }, [shiftId]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading slots...</div>;
  if (slots.length === 0) return null;

  return (
    <TooltipProvider>
      <div className="flex gap-1 flex-wrap">
        {slots.map((slot) => {
          const confirmed = bookings.filter(
            (b) => b.time_slot_id === slot.id && b.booking_status === "confirmed"
          );
          const waitlisted = bookings.filter(
            (b) => b.time_slot_id === slot.id && b.booking_status === "waitlisted"
          );
          const fillRatio = confirmed.length / slot.total_slots;
          const bgColor =
            fillRatio >= 1
              ? "bg-green-500/20 border-green-500/40 text-green-700 dark:text-green-400"
              : fillRatio >= 0.5
              ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-700 dark:text-yellow-400"
              : "bg-red-500/20 border-red-500/40 text-red-700 dark:text-red-400";

          return (
            <Tooltip key={slot.id}>
              <TooltipTrigger asChild>
                <div
                  className={`flex flex-col items-center rounded border px-2 py-1 text-[10px] cursor-default transition-colors ${bgColor}`}
                >
                  <span className="font-medium whitespace-nowrap">
                    {formatSlotRange(slot.slot_start, slot.slot_end)}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Users className="h-2.5 w-2.5" />
                    {confirmed.length}/{slot.total_slots}
                    {waitlisted.length > 0 && (
                      <span className="text-muted-foreground ml-0.5">+{waitlisted.length}w</span>
                    )}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-medium text-xs">
                    {formatSlotRange(slot.slot_start, slot.slot_end)} — {confirmed.length}/{slot.total_slots} booked
                  </p>
                  {confirmed.length > 0 && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Booked:</span>{" "}
                      {confirmed.map((b) => b.profiles?.full_name || "Unknown").join(", ")}
                    </div>
                  )}
                  {waitlisted.length > 0 && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Waitlisted:</span>{" "}
                      {waitlisted.map((b) => b.profiles?.full_name || "Unknown").join(", ")}
                    </div>
                  )}
                  {confirmed.length === 0 && waitlisted.length === 0 && (
                    <p className="text-xs text-muted-foreground">No volunteers assigned</p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
