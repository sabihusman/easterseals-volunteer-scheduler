import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { DatePicker } from "@/components/DatePicker";
import { TimePicker } from "@/components/TimePicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { previewSlots, formatSlotRange } from "@/lib/slot-utils";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  StickyNote,
  AlertCircle,
  UserPlus,
} from "lucide-react";
import { InviteVolunteerModal } from "@/components/InviteVolunteerModal";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Department {
  id: string;
  name: string;
}

interface Shift {
  id: string;
  title: string;
  department_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  total_slots: number;
  coordinator_note: string | null;
  departments?: { name: string };
}

interface ShiftForm {
  title: string;
  department_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  total_slots: number;
  coordinator_note: string;
}

const EMPTY_FORM: ShiftForm = {
  title: "",
  department_id: "",
  shift_date: "",
  start_time: "",
  end_time: "",
  total_slots: 1,
  coordinator_note: "",
};

const NOTE_MAX = 500;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Returns true if the shift starts more than 1 hour from now. */
function canEditNote(shiftDate: string, startTime: string): boolean {
  const shiftStart = new Date(`${shiftDate}T${startTime}`);
  const cutoff = new Date(shiftStart.getTime() - 60 * 60 * 1000);
  return new Date() < cutoff;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ManageShifts() {
  const { toast } = useToast();
  const { user, role } = useAuth();

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ShiftForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; bookingCount: number } | null>(null);
  const [inviteShift, setInviteShift] = useState<Shift | null>(null);

  /* ---------- Fetch ---------- */

  async function fetchShifts() {
    // For coordinators, scope to their assigned departments only so they
    // can't see (or act on) shifts in departments they don't manage.
    let deptFilter: string[] | null = null;
    if (role === "coordinator" && user) {
      const { data: assignments } = await supabase
        .from("department_coordinators")
        .select("department_id")
        .eq("coordinator_id", user.id);
      deptFilter = (assignments || []).map((a: any) => a.department_id);
      if (deptFilter.length === 0) {
        setShifts([]);
        return;
      }
    }

    let query = supabase
      .from("shifts")
      .select("*, departments(name)")
      // Don't show admin-cancelled shifts in coordinator's manage view
      .neq("status", "cancelled")
      .order("shift_date", { ascending: true });
    if (deptFilter) query = query.in("department_id", deptFilter);

    const { data } = await query;
    if (data) setShifts(data as Shift[]);
  }

  async function fetchDepartments() {
    // Coordinators only see the departments they're assigned to.
    // Admins see everything active.
    if (role === "coordinator" && user) {
      const { data } = await supabase
        .from("department_coordinators")
        .select("departments(id, name, is_active)")
        .eq("coordinator_id", user.id);
      const depts = ((data || []) as any[])
        .map((row) => row.departments)
        .filter((d: any) => d && d.is_active)
        .map((d: any) => ({ id: d.id, name: d.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setDepartments(depts);
      return;
    }

    const { data } = await supabase
      .from("departments")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    if (data) setDepartments(data);
  }

  useEffect(() => {
    // Wait until auth resolves so the role-based scoping can kick in
    if (!user || !role) return;
    Promise.all([fetchShifts(), fetchDepartments()]).then(() =>
      setLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, role]);

  /* ---------- Open dialog ---------- */

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(shift: Shift) {
    setEditingId(shift.id);
    setForm({
      title: shift.title ?? "",
      department_id: shift.department_id,
      shift_date: shift.shift_date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      total_slots: shift.total_slots,
      coordinator_note: shift.coordinator_note ?? "",
    });
    setDialogOpen(true);
  }

  /* ---------- Save ---------- */

  async function handleSave() {
    const missing: string[] = [];
    if (!form.title) missing.push("Shift Title");
    if (!form.department_id) missing.push("Department");

    // Coordinators must only save shifts in departments they're assigned to
    if (
      role === "coordinator" &&
      form.department_id &&
      !departments.some((d) => d.id === form.department_id)
    ) {
      toast({
        variant: "destructive",
        title: "Not assigned",
        description: "You are not assigned to this department. Contact an admin to be added.",
      });
      return;
    }
    if (!form.shift_date) missing.push("Date");
    if (!form.start_time) missing.push("Start Time (make sure AM/PM is set)");
    if (!form.end_time) missing.push("End Time (make sure AM/PM is set)");

    if (missing.length > 0) {
      toast({
        variant: "destructive",
        title: "Missing or invalid fields",
        description: `Please complete: ${missing.join(", ")}`,
      });
      return;
    }

    // Validate end time is after start time
    if (form.start_time >= form.end_time) {
      toast({
        variant: "destructive",
        title: "Invalid time range",
        description: "End time must be after start time.",
      });
      return;
    }

    // Sanity check: shifts over 12 hours are almost always AM/PM mistakes.
    // Require an explicit confirmation before saving.
    const [sh, sm] = form.start_time.split(":").map(Number);
    const [eh, em] = form.end_time.split(":").map(Number);
    const durationMin = (eh * 60 + em) - (sh * 60 + sm);
    if (durationMin > 12 * 60) {
      const ok = window.confirm(
        `This shift is ${Math.floor(durationMin / 60)}h ${durationMin % 60}m long. That's unusually long — did you mean to use PM for one of the times?\n\nClick OK to save anyway, or Cancel to fix the times.`
      );
      if (!ok) return;
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

    const { error } = editingId
      ? await supabase.from("shifts").update(payload).eq("id", editingId)
      : await supabase.from("shifts").insert({ ...payload, created_by: user!.id });

    setSaving(false);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: editingId ? "Shift updated" : "Shift created" });
      setDialogOpen(false);
      fetchShifts();
    }
  }

  /* ---------- Delete ---------- */

  async function requestDelete(id: string) {
    const { count: bookingCount } = await supabase
      .from("shift_bookings")
      .select("*", { count: "exact", head: true })
      .eq("shift_id", id)
      .eq("booking_status", "confirmed");
    setDeleteTarget({ id, bookingCount: bookingCount ?? 0 });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from("shifts").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Shift deleted" });
      fetchShifts();
    }
  }

  /* ---------- Note editability for the currently-open shift ---------- */

  const noteEditable = useMemo(() => {
    if (!editingId) return true; // new shift
    return canEditNote(form.shift_date, form.start_time);
  }, [editingId, form.shift_date, form.start_time]);

  /* ---------- Live duration calc (catches AM/PM mistakes at the form) ---------- */
  const durationInfo = useMemo(() => {
    if (!form.start_time || !form.end_time) return null;
    const [sh, sm] = form.start_time.split(":").map(Number);
    const [eh, em] = form.end_time.split(":").map(Number);
    if (Number.isNaN(sh) || Number.isNaN(eh)) return null;
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const diffMin = endMin - startMin;
    if (diffMin <= 0) return { text: "End must be after start", minutes: diffMin, warn: true };
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    return { text: parts.join(" ") || "0m", minutes: diffMin, warn: diffMin > 8 * 60 };
  }, [form.start_time, form.end_time]);

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Manage Shifts</h1>
        <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" /> New Shift
        </Button>
      </div>

      {/* ---- Table ---- */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-center">Max</TableHead>
              <TableHead className="text-center">Note</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No shifts yet. Create one to get started.
                </TableCell>
              </TableRow>
            )}
            {shifts.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">
                  {s.departments?.name ?? "—"}
                </TableCell>
                <TableCell>{s.shift_date}</TableCell>
                <TableCell>
                  {s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}
                </TableCell>
                <TableCell className="text-center">{s.total_slots}</TableCell>
                <TableCell className="text-center">
                  {s.coordinator_note ? (
                    <StickyNote className="mx-auto h-4 w-4 text-primary" />
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setInviteShift(s)} title="Invite volunteer">
                      <UserPlus className="h-4 w-4" />
                    </Button>
                    {/*
                     * Completed shifts are immutable (DB-enforced by
                     * enforce_completed_shift_immutability +
                     * prevent_delete_bookings_on_completed_shifts
                     * triggers). We hide both actions here so coordinators
                     * don't see a button that would only 500 on click.
                     */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(s)}
                      disabled={s.status === "completed"}
                      title={s.status === "completed" ? "Completed shifts cannot be edited" : undefined}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => requestDelete(s.id)}
                      disabled={s.status === "completed"}
                      title={s.status === "completed" ? "Completed shifts cannot be deleted" : undefined}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ---- Create / Edit Dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Shift" : "Create Shift"}
            </DialogTitle>
            <DialogDescription>
              Fill in the shift details below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-1.5">
              <Label>Shift Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Morning Grounds Keeping"
              />
            </div>

            {/* Department */}
            <div className="space-y-1.5">
              <Label>Department *</Label>
              <Select
                value={form.department_id}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, department_id: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <DatePicker
                value={form.shift_date}
                onChange={(v) => setForm((f) => ({ ...f, shift_date: v }))}
                placeholder="Select a date"
              />
            </div>

            {/* Time row */}
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

            {/* Live duration — catches AM/PM mistakes before saving */}
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

            {/* Max volunteers */}
            <div className="space-y-1.5">
              <Label>Max Volunteers *</Label>
              <Input
                type="number"
                min={1}
                value={form.total_slots}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    total_slots: Math.max(1, Number(e.target.value)),
                  }))
                }
              />
            </div>

            {/* Coordinator Note */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <StickyNote className="h-3.5 w-3.5 text-primary" />
                Coordinator Note
              </Label>

              {!noteEditable && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This note can no longer be edited — the shift starts in less
                  than 1 hour.
                </div>
              )}

              <Textarea
                value={form.coordinator_note}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    coordinator_note: e.target.value.slice(0, NOTE_MAX),
                  }))
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary hover:bg-primary/90"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Update Shift" : "Create Shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete confirmation ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.bookingCount > 0
                ? `This will permanently remove the shift and CANCEL ${deleteTarget.bookingCount} confirmed booking${deleteTarget.bookingCount !== 1 ? "s" : ""}. This cannot be undone.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Invite volunteer modal ---- */}
      {inviteShift && (
        <InviteVolunteerModal
          shift={inviteShift}
          open={!!inviteShift}
          onOpenChange={(open) => { if (!open) setInviteShift(null); }}
        />
      )}
    </div>
  );
}
