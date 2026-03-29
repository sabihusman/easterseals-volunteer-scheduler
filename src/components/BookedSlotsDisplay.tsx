import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { formatSlotRange, slotHours } from "@/lib/slot-utils";

interface Props {
  bookingId: string;
  compact?: boolean;
}

interface SlotData {
  slot_id: string;
  shift_time_slots: {
    slot_start: string;
    slot_end: string;
  };
}

export function BookedSlotsDisplay({ bookingId, compact = false }: Props) {
  const [slots, setSlots] = useState<SlotData[]>([]);

  useEffect(() => {
    supabase
      .from("shift_booking_slots")
      .select("slot_id, shift_time_slots(slot_start, slot_end)")
      .eq("booking_id", bookingId)
      .then(({ data }) => {
        setSlots((data as any) || []);
      });
  }, [bookingId]);

  if (slots.length === 0) return null;

  const totalH = slots.reduce((sum, s) => sum + slotHours(s.shift_time_slots.slot_start, s.shift_time_slots.slot_end), 0);
  const ranges = slots.map(s => formatSlotRange(s.shift_time_slots.slot_start, s.shift_time_slots.slot_end));

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
