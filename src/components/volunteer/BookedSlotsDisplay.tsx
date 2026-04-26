import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { formatSlotRange, slotHours } from "@/lib/slot-utils";

interface Props {
  /** Legacy mode: pass a single bookingId */
  bookingId?: string;
  /** New per-slot mode: pass shiftId + volunteerId */
  shiftId?: string;
  volunteerId?: string;
  compact?: boolean;
}

interface SlotInfo {
  slot_start: string;
  slot_end: string;
}

export function BookedSlotsDisplay({ bookingId, shiftId, volunteerId, compact = false }: Props) {
  const [slotInfos, setSlotInfos] = useState<SlotInfo[]>([]);

  useEffect(() => {
    if (shiftId && volunteerId) {
      // New model: query shift_bookings with joined shift_time_slots
      supabase
        .from("shift_bookings")
        .select("time_slot_id, shift_time_slots(slot_start, slot_end)")
        .eq("shift_id", shiftId)
        .eq("volunteer_id", volunteerId)
        .in("booking_status", ["confirmed", "waitlisted"])
        .not("time_slot_id", "is", null)
        .then(({ data }) => {
          const infos = (data || [])
            .filter((d: any) => d.shift_time_slots)
            .map((d: any) => ({
              slot_start: d.shift_time_slots.slot_start,
              slot_end: d.shift_time_slots.slot_end,
            }))
            .sort((a: SlotInfo, b: SlotInfo) => a.slot_start.localeCompare(b.slot_start));
          setSlotInfos(infos);
        });
    } else if (bookingId) {
      // Legacy: query via junction table
      supabase
        .from("shift_booking_slots")
        .select("slot_id, shift_time_slots(slot_start, slot_end)")
        .eq("booking_id", bookingId)
        .then(({ data }) => {
          const infos = (data || [])
            .filter((d: any) => d.shift_time_slots)
            .map((d: any) => ({
              slot_start: d.shift_time_slots.slot_start,
              slot_end: d.shift_time_slots.slot_end,
            }))
            .sort((a: SlotInfo, b: SlotInfo) => a.slot_start.localeCompare(b.slot_start));
          setSlotInfos(infos);
        });
    }
  }, [bookingId, shiftId, volunteerId]);

  if (slotInfos.length === 0) return null;

  const totalH = slotInfos.reduce((sum, s) => sum + slotHours(s.slot_start, s.slot_end), 0);
  const ranges = slotInfos.map(s => formatSlotRange(s.slot_start, s.slot_end));

  if (compact) {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" />{ranges.join(", ")} ({totalH}h)
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {ranges.map((r, i) => (
        <Badge key={i} variant="outline" className="text-[10px]">{r}</Badge>
      ))}
      <Badge variant="secondary" className="text-[10px]">{totalH}h</Badge>
    </div>
  );
}
