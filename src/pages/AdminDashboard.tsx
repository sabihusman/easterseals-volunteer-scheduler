import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Users } from "lucide-react";
import { format } from "date-fns";

export default function AdminDashboard() {
  const [shifts, setShifts] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [stats, setStats] = useState({ totalShifts: 0, totalBookings: 0, totalVolunteers: 0 });

  useEffect(() => {
    const fetch = async () => {
      const [{ data: depts }, { data: shiftData }, { count: volCount }] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true),
        supabase.from("shifts").select("*, departments(name)").order("shift_date", { ascending: false }).limit(50),
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "volunteer"),
      ]);
      setDepartments(depts || []);
      setShifts(shiftData || []);
      setStats({
        totalShifts: (shiftData || []).length,
        totalBookings: (shiftData || []).reduce((sum: number, s: any) => sum + s.booked_slots, 0),
        totalVolunteers: volCount || 0,
      });
    };
    fetch();
  }, []);

  const filtered = selectedDept === "all" ? shifts : shifts.filter((s) => s.department_id === selectedDept);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Admin Dashboard</h2>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{stats.totalShifts}</div><p className="text-sm text-muted-foreground">Total Shifts</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{stats.totalBookings}</div><p className="text-sm text-muted-foreground">Total Bookings</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{stats.totalVolunteers}</div><p className="text-sm text-muted-foreground">Volunteers</p></CardContent></Card>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Recent Shifts</h3>
        <Select value={selectedDept} onValueChange={setSelectedDept}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        {filtered.map((s) => (
          <Card key={s.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="font-medium">{s.title}</div>
                  <div className="flex gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{s.booked_slots}/{s.total_slots}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary">{s.departments?.name}</Badge>
                  <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
