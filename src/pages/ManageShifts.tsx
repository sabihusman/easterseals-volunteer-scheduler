import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  StickyNote,
  AlertCircle,
} from "lucide-react";

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
  const { user } = useAuth();

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ShiftForm>(EMPTY_FORM);

  /* ---------- Fetch ---------- */

  async function fetchShifts() {
    const { data } = await supabase
      .from("shifts")
      .select("*, departments(name)")
      .order("shift_date", { ascending: true });

    if (data) setShifts(data as Shift[]);
  }

  async function fetchDepartments() {
    const { data } = await supabase
      .from("departments")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    if (data) setDepartments(data);
  }

  useEffect(() => {
    Promise.all([fetchShifts(), fetchDepartments()]).then(() =>
      setLoading(false)
    );
  }, []);

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

  async function handleDelete(id: string) {
    // Check for active bookings first to warn the user
    const { count: bookingCount } = await supabase
      .from("shift_bookings")
      .select("*", { count: "exact", head: true })
      .eq("shift_id", id)
      .eq("booking_status", "confirmed");

    const warning = bookingCount && bookingCount > 0
      ? `Delete this shift?\n\nThis will permanently remove the shift and CANCEL ${bookingCount} confirmed booking${bookingCount !== 1 ? "s" : ""}. This cannot be undone.`
      : "Delete this shift? This cannot be undone.";

    if (!confirm(warning)) return;

    const { error } = await supabase.from("shifts").delete().eq("id", id);
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

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[#006B3E]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Manage Shifts</h1>
        <Button onClick={openCreate} className="bg-[#006B3E] hover:bg-[#005a33]">
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
                <TableCell colSpan={6} className="py-8 text-center text-gray-500">
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
                    <StickyNote className="mx-auto h-4 w-4 text-[#006B3E]" />
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(s.id)}
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
              <Input
                type="date"
                value={form.shift_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, shift_date: e.target.value }))
                }
              />
            </div>

            {/* Time row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start Time *</Label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start_time: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Time *</Label>
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end_time: e.target.value }))
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Tip: Click the time field, type the hours and minutes, then click the AM/PM area and press up/down arrows to switch.
            </p>

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
                <StickyNote className="h-3.5 w-3.5 text-[#006B3E]" />
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
              <p className="text-right text-xs text-gray-400">
                {form.coordinator_note.length}/{NOTE_MAX}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#006B3E] hover:bg-[#005a33]"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Update Shift" : "Create Shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
