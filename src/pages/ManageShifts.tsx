import { useEffect, useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Calendar, Clock, Users } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { timeLabel } from "@/lib/calendar-utils";
import { previewSlotCount } from "@/lib/slot-utils";
import { z } from "zod";

const shiftSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100, "Title must be under 100 characters"),
  totalSlots: z.number().int().min(1, "At least 1 slot required").max(100, "Maximum 100 slots"),
  description: z.string().max(500, "Description must be under 500 characters").optional(),
});

export default function ManageShifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<any>(null);

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
    setEditingShift(null);
  };

  const openEdit = (shift: any) => {
    setEditingShift(shift);
    setTitle(shift.title); setShiftDate(shift.shift_date); setTimeType(shift.time_type);
    setStartTime(shift.start_time || ""); setEndTime(shift.end_time || "");
    setTotalSlots(String(shift.total_slots)); setRequiresBg(shift.requires_bg_check);
    setAllowsGroup(shift.allows_group); setDeptId(shift.department_id);
    setDescription(shift.description || "");
    setDialogOpen(true);
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

    let error;
    if (editingShift) {
      ({ error } = await supabase.from("shifts").update(payload).eq("id", editingShift.id));
    } else {
      ({ error } = await supabase.from("shifts").insert({ ...payload, created_by: user.id }));
    }
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editingShift ? "Shift updated" : "Shift created" });
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Manage Shifts</h2>
          <p className="text-muted-foreground">Create and manage shifts for your department</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Create Shift</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
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
              <Button onClick={handleSave} disabled={loading || !title || !shiftDate} className="w-full">
                {loading ? "Saving..." : editingShift ? "Update Shift" : "Create Shift"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {shifts.map((s) => (
          <Card key={s.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.title}</span>
                    <Badge variant={s.status === "open" ? "default" : s.status === "cancelled" ? "destructive" : "secondary"}>{s.status}</Badge>
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
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
