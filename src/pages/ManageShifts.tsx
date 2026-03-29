import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ManageShifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [timeType, setTimeType] = useState<string>("morning");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [totalSlots, setTotalSlots] = useState("1");
  const [requiresBg, setRequiresBg] = useState(true);
  const [deptId, setDeptId] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data: coords } = await supabase
        .from("department_coordinators")
        .select("department_id, departments(id, name)")
        .eq("coordinator_id", user.id);
      const depts = (coords || []).map((c: any) => c.departments).filter(Boolean);
      setDepartments(depts);
      if (depts.length > 0) setDeptId(depts[0].id);
    };
    fetch();
  }, [user]);

  const handleCreate = async () => {
    if (!title || !shiftDate || !deptId || !user) return;
    setLoading(true);
    const { error } = await supabase.from("shifts").insert({
      title,
      shift_date: shiftDate,
      time_type: timeType as any,
      start_time: timeType === "custom" ? startTime || null : null,
      end_time: timeType === "custom" ? endTime || null : null,
      total_slots: parseInt(totalSlots) || 1,
      requires_bg_check: requiresBg,
      department_id: deptId,
      description: description || null,
      created_by: user.id,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Shift created" });
      setDialogOpen(false);
      setTitle(""); setDescription(""); setShiftDate(""); setTotalSlots("1");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Manage Shifts</h2>
          <p className="text-muted-foreground">Create and manage shifts for your department</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Create Shift</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create New Shift</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shift title" />
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
              )}
              <div className="space-y-2">
                <Label>Total Slots</Label>
                <Input type="number" min="1" value={totalSlots} onChange={(e) => setTotalSlots(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Requires Background Check</Label>
                <Switch checked={requiresBg} onCheckedChange={setRequiresBg} />
              </div>
              <Button onClick={handleCreate} disabled={loading || !title || !shiftDate} className="w-full">
                {loading ? "Creating..." : "Create Shift"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
