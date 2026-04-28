import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Clock, Users, CheckCircle, XCircle, AlertTriangle, Download, List, CalendarDays, Pencil } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { downloadCSV, timeLabel } from "@/lib/calendar-utils";
import { isUpcoming } from "@/lib/shift-lifecycle";
import { VolunteerActivityTab } from "@/components/coordinator/VolunteerActivityTab";
import { DepartmentVolunteersTab } from "@/components/coordinator/DepartmentVolunteersTab";

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
  const [hoursEditTarget, setHoursEditTarget] = useState<{ booking: any; shift: any } | null>(null);
  const [hoursEditValue, setHoursEditValue] = useState("");
  const [hoursSaving, setHoursSaving] = useState(false);
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

  const fetchShiftsAndBookings = useCallback(async () => {
    if (!selectedDept) return;
    let query = supabase
      .from("shifts")
      .select("*")
      // Exclude admin-cancelled shifts — they are considered deleted
      // from everyone's view except the admin panel itself.
      .neq("status", "cancelled")
      .order("shift_date", { ascending: true });

    if (selectedDept === "all") {
      // For coordinators, "all" means all of their assigned departments
      // (not every department in the org). Admins see everything.
      if (role !== "admin" && departments.length > 0) {
        query = query.in("department_id", departments.map((d: any) => d.id));
      }
    } else {
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
  }, [selectedDept, role, departments]);

  useEffect(() => {
    fetchShiftsAndBookings();
  }, [fetchShiftsAndBookings]);

  // ── Realtime: listen for check-in updates ──────────────────
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    // Subscribe to shift_bookings changes to detect real-time check-ins
    if (realtimeRef.current) {
      supabase.removeChannel(realtimeRef.current);
    }
    const channel = supabase
      .channel("coordinator-checkins")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "shift_bookings" },
        (payload) => {
          const updated = payload.new as any;
          // Update the booking in local state if it's one we're tracking
          setBookings((prev) =>
            prev.map((b) =>
              b.id === updated.id
                ? { ...b, checked_in: updated.checked_in, checked_in_at: updated.checked_in_at }
                : b
            )
          );
        }
      )
      .subscribe();
    realtimeRef.current = channel;

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    };
  }, [selectedDept]);

  const openHoursEditor = (booking: any, shift: any) => {
    setHoursEditTarget({ booking, shift });
    setHoursEditValue(
      booking.final_hours != null
        ? String(booking.final_hours)
        : ""
    );
  };

  const handleSaveHours = async () => {
    if (!hoursEditTarget) return;
    const parsed = parseFloat(hoursEditValue);
    if (Number.isNaN(parsed) || parsed < 0) {
      toast({ title: "Invalid hours", description: "Enter a non-negative number.", variant: "destructive" });
      return;
    }
    setHoursSaving(true);
    const { error } = await (supabase as any).rpc("admin_update_shift_hours", {
      p_booking_id: hoursEditTarget.booking.id,
      p_hours: parsed,
    });
    setHoursSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    // Optimistic local update
    setBookings((prev) =>
      prev.map((b) =>
        b.id === hoursEditTarget.booking.id
          ? { ...b, final_hours: parsed, hours_source: "coordinator" }
          : b
      )
    );
    setHoursEditTarget(null);
    toast({ title: "Hours updated", description: `Set to ${parsed}h and volunteer total recalculated.` });
  };

  const handleAttendance = async (bookingId: string, status: "attended" | "absent") => {
    if (status === "absent") {
      const ok = window.confirm(
        "This will mark the volunteer as absent. If the volunteer has reported attending this shift, the matter will be escalated to an admin for review."
      );
      if (!ok) return;
    }
    const { error } = await supabase
      .from("shift_bookings")
      .update({
        coordinator_status: status,
        coordinator_actioned_by: user!.id,
      })
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      // Re-fetch to get the trigger's side effects (confirmation_status, final_hours, dispute)
      const { data: updated } = await supabase
        .from("shift_bookings")
        .select("id, confirmation_status, coordinator_status, coordinator_actioned_at, final_hours, hours_source")
        .eq("id", bookingId)
        .single();
      if (updated) {
        setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, ...updated } : b));
      }
      // Check if dispute was created
      const { data: dispute } = await supabase
        .from("attendance_disputes")
        .select("id")
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (dispute) {
        toast({ title: "Dispute created", description: "The volunteer reported attending. An admin will review this dispute.", variant: "default" });
      } else {
        toast({ title: `Marked as ${status}` });
      }
    }
  };

  const handleExportHours = () => {
    const data = bookings
      .filter((b) => b.confirmation_status === "confirmed")
      .map((b) => {
        const shift = shifts.find((s) => s.id === b.shift_id);
        return {
          // See note in AdminDashboard's handleExportAll — profiles() is
          // null for deleted users thanks to the SET NULL FK cascade.
          Volunteer: b.profiles?.full_name || "[deleted user]",
          Email: b.profiles?.email || "",
          "Shift Date": shift?.shift_date || "",
          Shift: shift?.title || "",
          Time: shift ? timeLabel(shift) : "",
        };
      });
    downloadCSV(data, `dept_hours_${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  // Canonical upcoming = end timestamp in the future (not just `date >= today`,
  // which wrongly kept today's already-ended shifts in the list). Matches the
  // shared rule in src/lib/shift-lifecycle.ts.
  const upcomingShifts = shifts.filter((s) => isUpcoming(s));
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
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center w-full sm:w-auto">
          {role === "admin" && (
            <Select value={selectedDept} onValueChange={setSelectedDept}>
              <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {role !== "admin" && departments.length > 0 && (
            <Select value={selectedDept} onValueChange={setSelectedDept}>
              <SelectTrigger className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Offer an All option when coordinator manages more than one department */}
                {departments.length > 1 && (
                  <SelectItem value="all">All My Departments</SelectItem>
                )}
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
        <TabsList className="w-full grid grid-cols-3 h-auto sm:w-auto sm:inline-flex">
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm">Volunteer Activity</TabsTrigger>
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
                      {s.title} on {format(new Date(s.shift_date + "T00:00:00"), "MMM d")} — {s.booked_slots}/{s.total_slots} filled
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Tabs value={view} onValueChange={(v) => setView(v as "list" | "calendar")}>
              <TabsList>
                <TabsTrigger value="list" aria-label="List view"><List className="h-4 w-4" /></TabsTrigger>
                <TabsTrigger value="calendar" aria-label="Calendar view"><CalendarDays className="h-4 w-4" /></TabsTrigger>
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
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")}</span>
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
                                <div className="text-sm font-medium flex items-center gap-1.5">
                                  <span
                                    className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                                      b.checked_in || b.checked_in_at
                                        ? "bg-green-500"
                                        : "bg-gray-300"
                                    }`}
                                    title={
                                      b.checked_in || b.checked_in_at
                                        ? `Checked in${b.checked_in_at ? ` at ${new Date(b.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
                                        : "Not checked in"
                                    }
                                  />
                                  {b.profiles?.full_name}
                                  {(b.checked_in || b.checked_in_at) && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-green-50 text-green-700 border-green-200">
                                      Checked in
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">{b.profiles?.email}</div>
                                {b.profiles?.phone && <div className="text-xs text-muted-foreground">📞 {b.profiles.phone}</div>}
                                {b.profiles?.emergency_contact && <div className="text-xs text-muted-foreground">🆘 {b.profiles.emergency_contact}</div>}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {!b.coordinator_status && b.confirmation_status === "pending_confirmation" ? (
                                  <>
                                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleAttendance(b.id, "attended")}>
                                      <CheckCircle className="h-3 w-3 mr-1" />Mark Attended
                                    </Button>
                                    <Button size="sm" variant="destructive" onClick={() => handleAttendance(b.id, "absent")}>
                                      <XCircle className="h-3 w-3 mr-1" />Mark Absent
                                    </Button>
                                  </>
                                ) : b.coordinator_status ? (
                                  <>
                                    <Badge variant={b.coordinator_status === "attended" ? "default" : "destructive"} className="text-xs">
                                      {b.coordinator_status === "attended" ? "Attended" : "Absent"}
                                    </Badge>
                                    {b.coordinator_actioned_at && (
                                      <span className="text-[10px] text-muted-foreground">
                                        {format(new Date(b.coordinator_actioned_at), "MMM d, h:mm a")}
                                      </span>
                                    )}
                                    {/* Dispute badge — show if confirmation is still pending after absent marking */}
                                    {b.coordinator_status === "absent" && b.confirmation_status === "pending_confirmation" && (
                                      <Badge className="text-[10px] bg-amber-500/20 text-amber-700 border-amber-500/40">
                                        <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Disputed — Pending Admin Review
                                      </Badge>
                                    )}
                                    {b.confirmation_status === "confirmed" && (
                                      <>
                                        {b.final_hours != null && (
                                          <Badge variant="secondary" className="text-xs">{b.final_hours}h</Badge>
                                        )}
                                        <Button size="sm" variant="ghost" className="h-7 px-2"
                                          onClick={() => openHoursEditor(b, s)} title="Edit recorded hours">
                                          <Pencil className="h-3 w-3 mr-1" />Edit Hours
                                        </Button>
                                      </>
                                    )}
                                    {b.confirmation_status === "no_show" && (
                                      <Badge variant="destructive" className="text-xs">No Show</Badge>
                                    )}
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

      {/* Retroactive hour correction dialog */}
      <Dialog
        open={!!hoursEditTarget}
        onOpenChange={(open) => { if (!open) setHoursEditTarget(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Volunteer Hours</DialogTitle>
            <DialogDescription>
              Retroactively correct the recorded hours for this shift. Use this
              when a volunteer only completed part of the shift, or when the
              self-reported hours need adjustment.
            </DialogDescription>
          </DialogHeader>
          {hoursEditTarget && (
            <div className="space-y-4 py-2">
              <div className="text-sm space-y-1">
                <p><strong>{hoursEditTarget.booking.profiles?.full_name}</strong></p>
                <p className="text-muted-foreground">
                  {hoursEditTarget.shift.title} · {format(new Date(hoursEditTarget.shift.shift_date + "T00:00:00"), "MMM d, yyyy")}
                </p>
                <p className="text-muted-foreground">
                  {timeLabel(hoursEditTarget.shift)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Hours Worked</Label>
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  value={hoursEditValue}
                  onChange={(e) => setHoursEditValue(e.target.value)}
                  placeholder="e.g. 1.5"
                />
                <p className="text-xs text-muted-foreground">
                  This will update the volunteer's total hours and points.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoursEditTarget(null)} disabled={hoursSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveHours} disabled={hoursSaving || !hoursEditValue}>
              {hoursSaving ? "Saving..." : "Save Hours"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
