import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TimePickerProps {
  value?: string; // HH:mm (24-hour)
  onChange: (value: string) => void;
  disabled?: boolean;
  defaultHour?: number; // 24-hour default when value is empty
  defaultMinute?: number;
}

/**
 * TimePicker with separate Hour / Minute / AM-PM dropdowns.
 * Internally stores/emits 24-hour HH:mm format.
 */
export function TimePicker({ value, onChange, disabled, defaultHour = 9, defaultMinute = 0 }: TimePickerProps) {
  // On first mount with empty value, emit the default so the form state matches what's shown
  useEffect(() => {
    if (!value || !/^\d{1,2}:\d{2}/.test(value)) {
      const h24 = String(defaultHour).padStart(2, "0");
      const mm = String(defaultMinute).padStart(2, "0");
      onChange(`${h24}:${mm}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parse current value
  let hour24 = defaultHour;
  let minute = defaultMinute;
  if (value && /^\d{1,2}:\d{2}/.test(value)) {
    const [h, m] = value.split(":").map(Number);
    hour24 = h;
    minute = m;
  }

  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  const emit = (h12: number, m: number, p: "AM" | "PM") => {
    let h24 = h12 % 12;
    if (p === "PM") h24 += 12;
    const str = `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    onChange(str);
  };

  const hours = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={String(hour12)}
        onValueChange={(v) => emit(Number(v), minute, period)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[70px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[240px]">
          {hours.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">:</span>
      <Select
        value={String(minute)}
        onValueChange={(v) => emit(hour12, Number(v), period)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[70px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[240px]">
          {minutes.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {String(m).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={period}
        onValueChange={(v: "AM" | "PM") => emit(hour12, minute, v)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[70px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
