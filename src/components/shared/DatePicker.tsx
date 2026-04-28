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

export function DatePicker({ value, onChange, placeholder = "Pick a date", disabled }: DatePickerProps) {
  const dateValue = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;

  return (
    // modal={false}: when this Popover is mounted inside a Radix Dialog,
    // the Dialog's outside-pointer-down trap was intercepting clicks on
    // the portaled calendar content before react-day-picker's onSelect
    // could fire. Result: clicking a day closed the popover without
    // setting the date. Telling Popover not to render as a modal layer
    // tells the parent Dialog to leave its pointer events alone.
    <Popover modal={false}>
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
        // pointer-events-auto + z-[60]: PR #160's z-index bump alone
        // didn't resolve the bug. Diagnosis: Radix Dialog with
        // modal={true} (its default in DialogContent) sets
        // `pointer-events: none` on document.body while open.
        // PopoverContent is portaled to body via Radix Portal, so it
        // INHERITS pointer-events: none from body — even though it has
        // higher z-index, browsers' elementFromPoint() skips over
        // pointer-events:none elements, so the click goes through to
        // the dialog content beneath. That's the "subtree intercepts
        // pointer events" Playwright trace from PR #159.
        //
        // `pointer-events-auto` on PopoverContent breaks the
        // inheritance — the popover and its descendants reactivate
        // click handling. z-[60] keeps the popover stacked above the
        // dialog so it actually catches the clicks once they're
        // routable to it.
        //
        // Pairs with `modal={false}` (PR #156), onPointerDownOutside
        // and onOpenAutoFocus (PR #158), and z-[60] (PR #160). Each
        // layer addresses a different surface; all four remain.
        className="z-[60] w-auto p-0 pointer-events-auto"
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
            if (date) onChange(format(date, "yyyy-MM-dd"));
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
