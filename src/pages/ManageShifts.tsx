import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, Calendar, Clock, Users, Repeat } from "lucide-react";
import { format, addDays, addWeeks, addMonths, differenceInDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { timeLabel } from "@/lib/calendar-utils";
import { previewSlotCount } from "@/lib/slot-utils";
import { z } from "zod";

const shiftSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100, "Title must be under 100 characters"),
  totalSlots: z.number().int().min(1, "At least 1 slot required").max(100, "Maximum 100 slots"),
  description: z.string().max(500, "Description must be under 500 characters").optional(),
});

function generateRecurringDates(startDate: string, endDate: string, frequency: string): string[] {
  const dates: string[] = [];
  let current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (current <= end) {
    dates.push(format(current, "yyyy-MM-dd"));
    switch (frequency) {
      case "daily": current = addDays(current, 1); break;
      case "weekly": current = addWeeks(current, 1); break;
      case "biweekly": current = addWeeks(current, 2); break;
      case "monthly": current = addMonths(current, 1); break;
      default: current = addDays(current, 1);
    }
  }
  return dates;
}

export default function ManageShifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<any>(null);
  const [editRecurringPrompt, setEditRecurringPrompt] = useState<any>(null);
  const [deleteShiftPrompt, setDeleteShiftPrompt] = useState<any>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [timeType, setTimeType] = useState<string>("morning");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [totalSlots, setTotalSlots] = useState("1");
  const [requiresBg, setRequiresBg] = useState(true);
  const [allowsGroup, setAllowsGroup] = useState(false);
  const [deptId, setDeptId] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Recurring state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState("weekly");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");

  const maxEndDate = useMemo(() => {
    if (!shiftDate) return "";
    const d = new Date(shiftDate + "T00:00:00");
    return format(addMonths(d, 6), "yyyy-MM-dd");
  }, [shiftDate]);

  const recurringPreview = useMemo(() => {
    if (!isRecurring || !shiftDate || !recurrenceEndDate) return 0;
    return generateRecurringDates(shiftDate, recurrenceEndDate, recurrenceType).length;
  }, [isRecurring, shiftDate, recurrenceEndDate, recurrenceType]);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data: coords } = await supabase
        .from("department_coordinators")
        .select("department_id, departments(id, name)")
        .eq("coordinator_id", user.id);
      const depts = (coords || []).map((c: any) => c.departments).filter(Boolean);
      setDepartments(depts);
      if (depts.length > 0) {
        setDeptId(depts[0].id);
        fetchShifts(depts.map((d: any) => d.id));
      }
    };
    fetch();
  }, [user]);

  const fetchShifts = async (deptIds: string[]) => {
    const { data } = await supabase
      .from("shifts")
      .select("*, departments(name)")
      .in("department_id", deptIds)
      .order("shift_date", { ascending: false })
      .limit(100);
    setShifts(data || []);
  };

  const resetForm = () => {
    setTitle(""); setShiftDate(""); setTimeType("morning"); setStartTime(""); setEndTime("");
    setTotalSlots("1"); setRequiresBg(true); setAllowsGroup(false); setDescription("");
    setEditingShift(null); setIsRecurring(false); setRecurrenceType("weekly"); setRecurrenceEndDate("");
  };

  const openEdit = (shift: any) => {
    if (shift.is_recurring && shift.recurrence_parent) {
      setEditRecurringPrompt(shift);
      return;
    }
    doOpenEdit(shift);
  };

  const doOpenEdit = (shift: any) => {
    setEditingShift(shift);
    setTitle(shift.title); setShiftDate(shift.shift_date); setTimeType(shift.time_type);
    setStartTime(shift.start_time || ""); setEndTime(shift.end_time || "");
    setTotalSlots(String(shift.total_slots)); setRequiresBg(shift.requires_bg_check);
    setAllowsGroup(shift.allows_group); setDeptId(shift.department_id);
    setDescription(shift.description || "");
    setIsRecurring(false);
    setDialogOpen(true);
  };

  const handleEditFuture = async (shift: any) => {
    setEditRecurringPrompt(null);
    // Edit all future shifts in the series
    const parentId = shift.recurrence_parent || shift.id;
    doOpenEdit({ ...shift, _editFuture: true, _parentId: parentId });
  };

  const handleSave = async () => {
    if (!shiftDate || !deptId || !user) return;
    const result = shiftSchema.safeParse({
      title,
      totalSlots: parseInt(totalSlots) || 0,
      description: description || undefined,
    });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((e) => { fieldErrors[e.path[0] as string] = e.message; });
      setFormErrors(fieldErrors);
      return;
    }
    setFormErrors({});
    setLoading(true);
    const payload = {
      title,
      shift_date: shiftDate,
      time_type: timeType as any,
      start_time: timeType === "custom" ? startTime || null : null,
      end_time: timeType === "custom" ? endTime || null : null,
      total_slots: parseInt(totalSlots) || 1,
      requires_bg_check: requiresBg,
      allows_group: allowsGroup,
      department_id: deptId,
      description: description || null,
    };

    if (editingShift?._editFuture) {
      // Update all future shifts in series
      const { error } = await supabase
        .from("shifts")
        .update({ title, total_slots: parseInt(totalSlots) || 1, requires_bg_check: requiresBg, allows_group: allowsGroup, description: description || null })
        .eq("recurrence_parent", editingShift._parentId)
        .gte("shift_date", shiftDate);
      setLoading(false);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "All future shifts updated" });
        setDialogOpen(false); resetForm();
        fetchShifts(departments.map((d: any) => d.id));
      }
      return;
    }

    let error;
    if (editingShift) {
      ({ error } = await supabase.from("shifts").update(payload).eq("id", editingShift.id));
    } else if (isRecurring && recurrenceEndDate) {
      // Create recurring shifts
      const dates = generateRecurringDates(shiftDate, recurrenceEndDate, recurrenceType);
      if (dates.length === 0) {
        toast({ title: "No shifts to create", variant: "destructive" });
        setLoading(false);
        return;
      }

      // Insert recurrence rule
      await supabase.from("shift_recurrence_rules").insert({
        department_id: deptId,
        title,
        created_by: user.id,
        recurrence_type: recurrenceType as any,
        start_date: shiftDate,
        end_date: recurrenceEndDate,
        time_type: timeType as any,
        start_time: timeType === "custom" ? startTime || null : null,
        end_time: timeType === "custom" ? endTime || null : null,
        total_slots: parseInt(totalSlots) || 1,
        requires_bg_check: requiresBg,
        allows_group: allowsGroup,
        description: description || null,
      });

      // Create all shifts
      const firstShift = { ...payload, shift_date: dates[0], created_by: user.id, is_recurring: true };
      const { data: first, error: firstErr } = await supabase.from("shifts").insert(firstShift).select("id").single();
      if (firstErr || !first) {
        toast({ title: "Error creating first shift", description: firstErr?.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      const parentId = first.id;
      // Update first shift with its own parent
      await supabase.from("shifts").update({ recurrence_parent: parentId }).eq("id", parentId);

      if (dates.length > 1) {
        const remaining = dates.slice(1).map((d) => ({
          ...payload,
          shift_date: d,
          created_by: user.id,
          is_recurring: true,
          recurrence_parent: parentId,
        }));
        const { error: batchErr } = await supabase.from("shifts").insert(remaining);
        if (batchErr) {
          toast({ title: "Some shifts may not have been created", description: batchErr.message, variant: "destructive" });
        }
      }

      toast({ title: `${dates.length} recurring shifts created through ${format(new Date(recurrenceEndDate), "MMM d, yyyy")}` });
      error = undefined;
    } else {
      ({ error } = await supabase.from("shifts").insert({ ...payload, created_by: user.id }));
    }
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      if (!isRecurring) toast({ title: editingShift ? "Shift updated" : "Shift created" });
      setDialogOpen(false);
      resetForm();
      fetchShifts(departments.map((d: any) => d.id));
    }
  };

  const handleCancel = async (shiftId: string) => {
    const { error } = await supabase.from("shifts").update({ status: "cancelled" as any }).eq("id", shiftId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setShifts((prev) => prev.map((s) => s.id === shiftId ? { ...s, status: "cancelled" } : s));
      toast({ title: "Shift cancelled" });
    }
  };
  const handleDeleteShift = async (shift: any) => {
    const { error } = await supabase.from("shifts").delete().eq("id", shift.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setShifts((prev) => prev.filter((s) => s.id !== shift.id));
      toast({ title: "Shift deleted." });
    }
    setDeleteShiftPrompt(null);
  };


    return (
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Manage Shifts</h2>
          <p className="text-muted-foreground">Create and manage shifts for your department</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Create Shift</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingShift ? "Edit Shift" : "Create New Shift"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shift title" maxLength={100} />
                {formErrors.title && <p className="text-xs text-destructive">{formErrors.title}</p>}
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={deptId} onValueChange={setDeptId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Time Type</Label>
                  <Select value={timeType} onValueChange={setTimeType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="morning">Morning</SelectItem>
                      <SelectItem value="afternoon">Afternoon</SelectItem>
                      <SelectItem value="all_day">All Day</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {timeType === "custom" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </div>
                  </div>
                  {startTime && endTime && previewSlotCount(startTime, endTime) > 0 && (
                    <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1">
                      ⏱ This shift will be divided into {previewSlotCount(startTime, endTime)} × 2-hour slot{previewSlotCount(startTime, endTime) !== 1 ? "s" : ""} for volunteer booking
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label>Total Slots</Label>
                <Input type="number" min="1" max="100" value={totalSlots} onChange={(e) => setTotalSlots(e.target.value)} />
                {formErrors.totalSlots && <p className="text-xs text-destructive">{formErrors.totalSlots}</p>}
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
                {formErrors.description && <p className="text-xs text-destructive">{formErrors.description}</p>}
                <p className="text-xs text-muted-foreground">{description.length}/500</p>
              </div>
              <div className="flex items-center justify-between">
                <Label>Requires Background Check</Label>
                <Switch checked={requiresBg} onCheckedChange={setRequiresBg} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Allow Group Bookings</Label>
                <Switch checked={allowsGroup} onCheckedChange={setAllowsGroup} />
              </div>

              {/* Recurring section */}
              {!editingShift && (
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Repeat className="h-4 w-4" />Make this a recurring shift</Label>
                    <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
                  </div>
                  {isRecurring && (
                    <>
                      <div className="space-y-2">
                        <Label>Repeat frequency</Label>
                        <RadioGroup value={recurrenceType} onValueChange={setRecurrenceType} className="flex flex-wrap gap-3">
                          <div className="flex items-center space-x-1"><RadioGroupItem value="daily" id="daily" /><Label htmlFor="daily" className="text-sm">Daily</Label></div>
                          <div className="flex items-center space-x-1"><RadioGroupItem value="weekly" id="weekly" /><Label htmlFor="weekly" className="text-sm">Weekly</Label></div>
                          <div className="flex items-center space-x-1"><RadioGroupItem value="biweekly" id="biweekly" /><Label htmlFor="biweekly" className="text-sm">Bi-weekly</Label></div>
                          <div className="flex items-center space-x-1"><RadioGroupItem value="monthly" id="monthly" /><Label htmlFor="monthly" className="text-sm">Monthly</Label></div>
                        </RadioGroup>
                      </div>
                      <div className="space-y-2">
                        <Label>End date</Label>
                        <Input
                          type="date"
                          value={recurrenceEndDate}
                          onChange={(e) => setRecurrenceEndDate(e.target.value)}
                          min={shiftDate}
                          max={maxEndDate}
                        />
                        {recurrenceEndDate && maxEndDate && recurrenceEndDate > maxEndDate && (
                          <p className="text-xs text-destructive">Recurring shifts cannot extend beyond 6 months</p>
                        )}
                      </div>
                      {recurringPreview > 0 && (
                        <p className="text-sm text-muted-foreground bg-muted rounded px-3 py-2">
                          📅 This will create <span className="font-medium">{recurringPreview} shifts</span>
                          {recurrenceEndDate && ` through ${format(new Date(recurrenceEndDate + "T00:00:00"), "MMM d, yyyy")}`}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <Button onClick={handleSave} disabled={loading || !title || !shiftDate || (isRecurring && (!recurrenceEndDate || recurrenceEndDate > maxEndDate))} className="w-full">
                {loading ? "Saving..." : editingShift ? "Update Shift" : isRecurring ? `Create ${recurringPreview} Shifts` : "Create Shift"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit recurring prompt */}
      <AlertDialog open={!!editRecurringPrompt} onOpenChange={() => setEditRecurringPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Recurring Shift</AlertDialogTitle>
            <AlertDialogDescription>This shift is part of a recurring series. How would you like to edit it?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { doOpenEdit(editRecurringPrompt); setEditRecurringPrompt(null); }}>
              This shift only
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleEditFuture(editRecurringPrompt)}>
              All future shifts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete cancelled shift dialog */}
      <AlertDialog open={!!deleteShiftPrompt} onOpenChange={() => setDeleteShiftPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will also remove all booking records associated with it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDeleteShift(deleteShiftPrompt)}>
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        {shifts.map((s) => (
          <Card key={s.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.title}</span>
                    <Badge variant={s.status === "open" ? "default" : s.status === "cancelled" ? "destructive" : "secondary"}>{s.status}</Badge>
                    {s.is_recurring && <Badge variant="outline" className="text-xs"><Repeat className="h-3 w-3 mr-1" />Recurring</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{s.booked_slots}/{s.total_slots}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">{s.departments?.name}</Badge>
                </div>
                <div className="flex gap-2">
                  {s.status !== "cancelled" && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
                        <Edit className="h-3 w-3 mr-1" />Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleCancel(s.id)}>
                        <Trash2 className="h-3 w-3 mr-1" />Cancel
                      </Button>
                    </>
                  )}
                  {s.status === "cancelled" && (
                    <Button variant="destructive" size="sm" onClick={() => setDeleteShiftPrompt(s)}>
                      <Trash2 className="h-3 w-3 mr-1" />Delete
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
