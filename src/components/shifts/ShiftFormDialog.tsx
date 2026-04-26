import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import { TimePicker } from "@/components/TimePicker";
import { Loader2, StickyNote, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { previewSlots, formatSlotRange } from "@/lib/slot-utils";
import {
  EMPTY_SHIFT_FORM,
  NOTE_MAX,
  canEditNote,
  computeDurationInfo,
  validateShiftForm,
  type ShiftForm,
} from "@/lib/shift-validation";
import type { Department, Shift } from "@/hooks/useShiftsList";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When non-null, dialog opens in edit mode and pre-populates the form. */
  editingShift: Shift | null;
  departments: Department[];
  userId: string;
  role: string | null;
  /** Called after a successful save so the parent can refresh the list. */
  onSaved: () => void;
}

/**
 * Create / Edit shift dialog. Owns its own form state — opening in edit mode
 * pre-populates from `editingShift`, opening in create mode resets to
 * `EMPTY_SHIFT_FORM`. Save flow:
 *   1. validateShiftForm → toast on each non-ok kind
 *   2. >12h shift confirmation via window.confirm (UI concern stays here)
 *   3. supabase insert (create) or update (edit)
 *   4. onSaved + close
 */
export function ShiftFormDialog({
  open, onOpenChange,
  editingShift,
  departments,
  userId,
  role,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<ShiftForm>(EMPTY_SHIFT_FORM);
  const [saving, setSaving] = useState(false);

  // Re-sync form whenever the dialog opens or the editing target changes.
  useEffect(() => {
    if (!open) return;
    if (editingShift) {
      setForm({
        title: editingShift.title ?? "",
        department_id: editingShift.department_id,
        shift_date: editingShift.shift_date,
        start_time: editingShift.start_time,
        end_time: editingShift.end_time,
        total_slots: editingShift.total_slots,
        coordinator_note: editingShift.coordinator_note ?? "",
      });
    } else {
      setForm(EMPTY_SHIFT_FORM);
    }
  }, [open, editingShift]);

  const noteEditable = useMemo(() => {
    if (!editingShift) return true; // new shift
    return canEditNote(form.shift_date, form.start_time);
  }, [editingShift, form.shift_date, form.start_time]);

  const durationInfo = useMemo(
    () => computeDurationInfo(form.start_time, form.end_time),
    [form.start_time, form.end_time]
  );

  async function handleSave() {
    const result = validateShiftForm(form, departments, role);
    if (!result.ok) {
      switch (result.kind) {
        case "missing":
          toast({
            variant: "destructive",
            title: "Missing or invalid fields",
            description: `Please complete: ${result.missing.join(", ")}`,
          });
          return;
        case "not_assigned":
          toast({
            variant: "destructive",
            title: "Not assigned",
            description: "You are not assigned to this department. Contact an admin to be added.",
          });
          return;
        case "invalid_range":
          toast({
            variant: "destructive",
            title: "Invalid time range",
            description: "End time must be after start time.",
          });
          return;
        case "long_shift_needs_confirm": {
          const hours = Math.floor(result.durationMin / 60);
          const mins = result.durationMin % 60;
          const ok = window.confirm(
            `This shift is ${hours}h ${mins}m long. That's unusually long — did you mean to use PM for one of the times?\n\nClick OK to save anyway, or Cancel to fix the times.`
          );
          if (!ok) return;
          break;
        }
      }
    }

    setSaving(true);
    const payload = {
      title: form.title,
      department_id: form.department_id,
      shift_date: form.shift_date,
      start_time: form.start_time,
      end_time: form.end_time,
      total_slots: form.total_slots,
      coordinator_note: form.coordinator_note.trim() || null,
    };

    const { error } = editingShift
      ? await supabase.from("shifts").update(payload).eq("id", editingShift.id)
      : await supabase.from("shifts").insert({ ...payload, created_by: userId });

    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
      return;
    }
    toast({ title: editingShift ? "Shift updated" : "Shift created" });
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingShift ? "Edit Shift" : "Create Shift"}</DialogTitle>
          <DialogDescription>Fill in the shift details below.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Shift Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Morning Grounds Keeping"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Department *</Label>
            <Select
              value={form.department_id}
              onValueChange={(v) => setForm((f) => ({ ...f, department_id: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Date *</Label>
            <DatePicker
              value={form.shift_date}
              onChange={(v) => setForm((f) => ({ ...f, shift_date: v }))}
              placeholder="Select a date"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Start Time *</Label>
              <TimePicker
                value={form.start_time}
                onChange={(v) => setForm((f) => ({ ...f, start_time: v }))}
                defaultHour={9}
                defaultMinute={0}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End Time *</Label>
              <TimePicker
                value={form.end_time}
                onChange={(v) => setForm((f) => ({ ...f, end_time: v }))}
                defaultHour={17}
                defaultMinute={0}
              />
            </div>
          </div>

          {durationInfo && (
            <div
              className={`rounded-md border px-3 py-2 text-sm flex items-center justify-between ${
                durationInfo.minutes <= 0
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : durationInfo.warn
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-800"
                  : "border-muted bg-muted/30"
              }`}
            >
              <span className="font-medium">Duration: {durationInfo.text}</span>
              {durationInfo.warn && durationInfo.minutes > 0 && (
                <span className="text-xs">Double-check AM/PM on your times.</span>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Max Volunteers *</Label>
            <Input
              type="number"
              min={1}
              value={form.total_slots}
              onChange={(e) =>
                setForm((f) => ({ ...f, total_slots: Math.max(1, Number(e.target.value)) }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <StickyNote className="h-3.5 w-3.5 text-primary" />
              Coordinator Note
            </Label>

            {!noteEditable && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This note can no longer be edited — the shift starts in less than 1 hour.
              </div>
            )}

            <Textarea
              value={form.coordinator_note}
              onChange={(e) =>
                setForm((f) => ({ ...f, coordinator_note: e.target.value.slice(0, NOTE_MAX) }))
              }
              placeholder="Optional note visible to assigned volunteers…"
              rows={3}
              disabled={!noteEditable}
              className="resize-none disabled:opacity-60"
            />
            <p className="text-right text-xs text-muted-foreground/60">
              {form.coordinator_note.length}/{NOTE_MAX}
            </p>
          </div>
        </div>

        {/* Slot preview */}
        {form.start_time && form.end_time && form.end_time > form.start_time && (() => {
          const slots = previewSlots(form.start_time, form.end_time);
          if (slots.length === 0) return null;
          return (
            <div className="rounded-md border border-muted bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                This shift will be split into {slots.length} × 2-hour slot{slots.length !== 1 ? "s" : ""}
              </p>
              <div className="flex flex-wrap gap-1">
                {slots.map((slot, i) => (
                  <span key={i} className="inline-block text-xs bg-background border rounded px-2 py-0.5">
                    {formatSlotRange(slot.start, slot.end)}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Each slot has capacity for {form.total_slots} volunteer{form.total_slots !== 1 ? "s" : ""}. Slots are generated automatically.
              </p>
            </div>
          );
        })()}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingShift ? "Update Shift" : "Create Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
