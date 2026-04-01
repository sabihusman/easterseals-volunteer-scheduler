import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Clock, Users, CheckCircle, XCircle, AlertTriangle, Download, List, CalendarDays } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { downloadCSV, timeLabel } from "@/lib/calendar-utils";
import { VolunteerActivityTab } from "@/components/VolunteerActivityTab";
import { DepartmentVolunteersTab } from "@/components/DepartmentVolunteersTab";

export default function CoordinatorDashboard() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [shifts, setShifts] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calMonth, setCalMonth] = useState(new Date());
  const [tab, setTab] = useState("shifts");

  useEffect(() => {
    if (!user) return;
    const fetchDepts = async () => {
      if (role === "admin") {
        const { data: allDepts } = await supabase
          .from("departments")
          .select("id, name")
          .eq("is_active", true)
          .order("name");
        const depts = allDepts || [];
        setDepartments(depts);
        setSelectedDept("all");
      } else {
        const { data: coords } = await supabase
          .from("department_coordinators")
          .select("department_id, departments(id, name)")
          .eq("coordinator_id", user.id);
        const depts = (coords || []).map((c: any) => c.departments).filter(Boolean);
        setDepartments(depts);
        if (depts.length > 0) setSelectedDept(depts[0].id);
      }
      setLoading(false);
    };
    fetchDepts();
  }, [user, role]);

  useEffect(() => {
    if (!selectedDept) return;
    const fetchShiftsAndBookings = async () => {
      let query = supabase
        .from("shifts")
        .select("*")
        .order("shift_date", { ascending: true });

      if (selectedDept !== "all") {
        query = query.eq("department_id", selectedDept);
      }

      const { data: shiftData } = await query;
      setShifts(shiftData || []);

      const shiftIds = (shiftData || []).map((s: any) => s.id);
      if (shiftIds.length > 0) {
        const { data: bookingData } = await supabase
          .from("shift_bookings")
          .select("*, profiles!shift_bookings_volunteer_id_fkey(full_name, email, phone, emergency_contact)")
          .in("shift_id", shiftIds)
          .eq("booking_status", "confirmed");
        setBookings(bookingData || []);
      } else {
        setBookings([]);
      }
    };
    fetchShiftsAndBookings();
  }, [selectedDept]);

  const handleConfirm = async (bookingId: string, status: "confirmed" | "no_show") => {
    const { error } = await supabase
      .from("shift_bookings")
      .update({ confirmation_status: status, confirmed_by: user!.id, confirmed_at: new Date().toISOString() })
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, confirmation_status: status } : b));
      toast({ title: `Marked as ${status.replace("_", " ")}` });
    }
  };

  const handleExportHours = () => {
    const data = bookings
      .filter((b) => b.confirmation_status === "confirmed")
      .map((b) => {
        const shift = shifts.find((s) => s.id === b.shift_id);
        return {
          Volunteer: b.profiles?.full_name || "",
          Email: b.profiles?.email || "",
          "Shift Date": shift?.shift_date || "",
          Shift: shift?.title || "",
          Time: shift ? timeLabel(shift) : "",
        };
      });
    downloadCSV(data, `dept_hours_${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  const upcomingShifts = shifts.filter((s) => s.shift_date >= new Date().toISOString().split("T")[0]);
  const lowCoverage = upcomingShifts.filter((s) => s.booked_slots < Math.ceil(s.total_slots * 0.5));
  const monthStart = startOfMonth(calMonth);
  const monthEnd = endOfMonth(calMonth);
  const calendarDays = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });
  const activeDeptIds = selectedDept === "all"
    ? departments.map((d: any) => d.id)
    : [selectedDept];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Department Shifts</h2>
          <p className="text-muted-foreground">{role === "admin" ? "All department shifts" : "Manage shifts for your department"}</p>
        </div>
        <div className="flex gap-2 items-center">
          {role === "admin" && (
            <Select value={selectedDept} onValueChange={setSelectedDept}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {role !== "admin" && departments.length > 0 && (
            <Select value={selectedDept} onValueChange={setSelectedDept}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={handleExportHours}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="activity">Volunteer Activity</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteers</TabsTrigger>
        </TabsList>

        <TabsContent value="shifts" className="space-y-4 mt-4">
          {lowCoverage.length > 0 && (
            <Card className="border-warning">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-warning font-medium text-sm mb-2">
                  <AlertTriangle className="h-4 w-4" /> Low Coverage Alerts
                </div>
                <div className="space-y-1">
                  {lowCoverage.slice(0, 5).map((s) => (
                    <div key={s.id} className="text-sm text-muted-foreground">
                      {s.title} on {format(new Date(s.shift_date), "MMM d")} — {s.booked_slots}/{s.total_slots} filled
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Tabs value={view} onValueChange={(v) => setView(v as "list" | "calendar")}>
              <TabsList>
                <TabsTrigger value="list"><List className="h-4 w-4" /></TabsTrigger>
                <TabsTrigger value="calendar"><CalendarDays className="h-4 w-4" /></TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {departments.length === 0 ? (
            <Card><CardContent className="pt-6 text-center text-muted-foreground">You're not assigned to any department.</CardContent></Card>
          ) : view === "calendar" ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <Button variant="outline" size="sm" onClick={() => setCalMonth(subMonths(calMonth, 1))}>← Prev</Button>
                <h3 className="text-lg font-semibold">{format(calMonth, "MMMM yyyy")}</h3>
                <Button variant="outline" size="sm" onClick={() => setCalMonth(addMonths(calMonth, 1))}>Next →</Button>
              </div>
              <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
                ))}
                {calendarDays.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const dayShifts = shifts.filter((s) => s.shift_date === dateStr);
                  return (
                    <div key={day.toISOString()} className={`bg-card min-h-[80px] p-1.5 ${!isSameMonth(day, calMonth) ? "opacity-40" : ""} ${isSameDay(day, new Date()) ? "ring-2 ring-primary ring-inset" : ""}`}>
                      <div className="text-xs font-medium mb-1">{format(day, "d")}</div>
                      {dayShifts.slice(0, 3).map((s) => (
                        <div key={s.id} className={`text-[10px] px-1 py-0.5 rounded truncate mb-0.5 ${s.booked_slots >= s.total_slots ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary"}`}>
                          {s.title} ({s.booked_slots}/{s.total_slots})
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {shifts.map((s) => {
                const shiftBookings = bookings.filter((b) => b.shift_id === s.id);
                return (
                  <Card key={s.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{s.title}</CardTitle>
                        <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status}</Badge>
                      </div>
                      <div className="flex gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{s.booked_slots}/{s.total_slots}</span>
                      </div>
                    </CardHeader>
                    {shiftBookings.length > 0 && (
                      <CardContent>
                        <div className="space-y-2">
                          {shiftBookings.map((b) => (
                            <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50">
                              <div>
                                <div className="text-sm font-medium">{b.profiles?.full_name}</div>
                                <div className="text-xs text-muted-foreground">{b.profiles?.email}</div>
                                {b.profiles?.phone && <div className="text-xs text-muted-foreground">📞 {b.profiles.phone}</div>}
                                {b.profiles?.emergency_contact && <div className="text-xs text-muted-foreground">🆘 {b.profiles.emergency_contact}</div>}
                              </div>
                              <div className="flex items-center gap-2">
                                {b.confirmation_status === "pending_confirmation" ? (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => handleConfirm(b.id, "confirmed")}>
                                      <CheckCircle className="h-3 w-3 mr-1" />Confirm
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleConfirm(b.id, "no_show")}>
                                      <XCircle className="h-3 w-3 mr-1" />No Show
                                    </Button>
                                  </>
                                ) : (
                                  <Badge variant={b.confirmation_status === "confirmed" ? "default" : "destructive"} className="text-xs">
                                    {b.confirmation_status.replace("_", " ")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <VolunteerActivityTab departmentIds={activeDeptIds} />
        </TabsContent>

        <TabsContent value="volunteers" className="mt-4">
          <DepartmentVolunteersTab departmentIds={activeDeptIds} departments={selectedDept === "all" ? departments : departments.filter(d => d.id === selectedDept)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
