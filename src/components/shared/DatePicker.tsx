import { useEffect } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value?: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  WIP — DIAGNOSTIC INSTRUMENTATION (PR #156 follow-up)                ║
// ║                                                                      ║
// ║  Candidate A (`modal={false}`) didn't fix the live behavior despite ║
// ║  CI passing. This commit captures real event flow on the user's     ║
// ║  Vercel preview so we can see WHICH event is being consumed and     ║
// ║  WHERE.                                                              ║
// ║                                                                      ║
// ║  How to use:                                                         ║
// ║   1. Open the preview, navigate to admin's Manage Shifts page       ║
// ║   2. Open browser DevTools → Console tab                            ║
// ║   3. Click "New Shift" to open the dialog                           ║
// ║   4. Click the Date field, then click any day in the calendar       ║
// ║   5. Copy the [DatePicker DIAG] console lines and share them        ║
// ║                                                                      ║
// ║  This block + all the `console.log` / event listener code is        ║
// ║  REMOVED before merge. No behavior change beyond logging.           ║
// ╚══════════════════════════════════════════════════════════════════════╝
const DIAG = "[DatePicker DIAG]";

export function DatePicker({ value, onChange, placeholder = "Pick a date", disabled }: DatePickerProps) {
  const dateValue = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;

  // [DIAG WIP] Document-level capture-phase listeners for the three
  // pointer events. Filters to events whose target is inside a Radix
  // popper wrapper or is a calendar day button. The capture phase
  // fires before any element-level handler, so we'll see exactly which
  // event is intercepted and at what stage.
  useEffect(() => {
    const matchesDatePicker = (target: HTMLElement | null): boolean => {
      if (!target) return false;
      // react-day-picker day buttons
      if (target.tagName === "BUTTON" && target.getAttribute("name") === "day") return true;
      // Radix popper wrapper or popover content
      if (typeof target.closest === "function") {
        if (target.closest("[data-radix-popper-content-wrapper]")) return true;
        if (target.closest("[data-radix-popover-content]")) return true;
      }
      return false;
    };

    const log = (label: string) => (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!matchesDatePicker(target)) return;
      const ct = e.currentTarget as HTMLElement | null;
      console.log(`${DIAG} ${label}`, {
        defaultPrevented: e.defaultPrevented,
        eventPhase: e.eventPhase, // 1=capture, 2=at-target, 3=bubble
        targetTag: target?.tagName,
        targetName: target?.getAttribute("name"),
        targetText: target?.textContent?.slice(0, 30).trim(),
        targetClass: typeof target?.className === "string" ? target.className.slice(0, 80) : null,
        currentTargetTag: ct?.tagName ?? "document",
      });
    };

    const wiring: Array<[keyof DocumentEventMap, boolean]> = [
      ["pointerdown", true],
      ["mousedown", true],
      ["click", true],
      ["pointerdown", false],
      ["mousedown", false],
      ["click", false],
    ];

    const cleanups: Array<() => void> = [];
    for (const [evt, capture] of wiring) {
      const handler = log(`${evt} ${capture ? "capture" : "bubble"}`);
      document.addEventListener(evt, handler, capture);
      cleanups.push(() => document.removeEventListener(evt, handler, capture));
    }
    return () => cleanups.forEach((c) => c());
  }, []);

  return (
    <Popover
      modal={false}
      // [DIAG WIP] Log every open/close transition. Pattern A says
      // we should see onOpenChange(false) without a corresponding
      // onSelect having fired.
      onOpenChange={(open) => {
        console.log(`${DIAG} Popover.onOpenChange`, { open });
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !dateValue && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {dateValue ? format(dateValue, "MMMM d, yyyy") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        // Sabih's diagnostic from PR #156 captured zero pointerdown /
        // click / Calendar.onSelect events on production despite
        // `modal={false}` — only Popover.onOpenChange(false) fired,
        // meaning something was consuming pointer events on the
        // popover content before they reached the calendar.
        //
        // Two-part hardening:
        //
        // 1. onOpenAutoFocus → preventDefault: stops Radix from
        //    auto-focusing the first focusable element inside the
        //    popover. The auto-focus interacts with the parent
        //    Dialog's focus trap when content is portaled, in some
        //    browsers / extensions producing a focus-stolen event
        //    that downstream handlers misinterpret as outside-click.
        //
        // 2. onPointerDownOutside → conditional preventDefault:
        //    when the pointerdown target is INSIDE the Radix popper
        //    wrapper (i.e. on the calendar itself), prevent the
        //    parent Dialog's outside-pointer-down trap from acting
        //    on it. We still allow real outside clicks to close the
        //    popover normally — that's why we don't unconditionally
        //    preventDefault.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target?.closest?.("[data-radix-popper-content-wrapper]")) {
            e.preventDefault();
          }
        }}
      >
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={(date) => {
            // [DIAG WIP] Did onSelect fire? With what value?
            console.log(`${DIAG} Calendar.onSelect`, {
              date,
              isoString: date?.toISOString() ?? null,
            });
            if (date) {
              const formatted = format(date, "yyyy-MM-dd");
              console.log(`${DIAG} calling onChange(...) with`, formatted);
              onChange(formatted);
            } else {
              console.log(`${DIAG} onSelect fired with falsy date — onChange NOT called`);
            }
          }}
          // initialFocus removed: Sabih's diagnostic showed zero
          // events reached the calendar in production. The auto-
          // focus react-day-picker performs when initialFocus is
          // set can interact badly with the parent Dialog's focus
          // trap when popover content is portaled. Pairs with the
          // onOpenAutoFocus preventDefault on PopoverContent above.
        />
      </PopoverContent>
    </Popover>
  );
}
