import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar, Users, Download, Trash2, XCircle, Search } from "lucide-react";
import { format } from "date-fns";
import { downloadCSV, timeLabel, parseShiftDate } from "@/lib/calendar-utils";
import { DepartmentCoordinatorManager } from "@/components/DepartmentCoordinatorManager";
import { VolunteerLeaderboard } from "@/components/VolunteerLeaderboard";
import { useToast } from "@/hooks/use-toast";

const DEPT_COLORS: Record<string, string> = {
  "Grounds & Facilities": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Camp Sunnyside": "bg-amber-100 text-amber-800 border-amber-200",
  "Adult Day Services": "bg-blue-100 text-blue-800 border-blue-200",
  "Children's Services": "bg-purple-100 text-purple-800 border-purple-200",
  "Transportation": "bg-orange-100 text-orange-800 border-orange-200",
  "Administration": "bg-muted text-foreground border-border",
};

function deptBadgeClass(name: string) {
  return DEPT_COLORS[name] || "bg-muted text-muted-foreground";
}

const STATUS_BADGE: Record<string, string> = {
  open: "default",
  full: "secondary",
  cancelled: "destructive",
  completed: "outline",
};

export default function AdminDashboard() {
  const { toast } = useToast();
  const [shifts, setShifts] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("upcoming");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Dialogs
  const [cancelPrompt, setCancelPrompt] = useState<any>(null);
  const [deletePrompt, setDeletePrompt] = useState<any>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Stats
  const [stats, setStats] = useState({ totalShifts: 0, totalBookings: 0, totalVolunteers: 0 });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      // Use a light id-only SELECT rather than a HEAD count — the HEAD
      // count path through PostgREST is disproportionately expensive when
      // the table has multi-policy RLS (especially profiles) and has been
      // returning 503s from the pooler in production.
      const [{ data: depts }, { data: shiftData }, { data: vols }] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true),
        supabase
          .from("shifts")
          .select("*, departments(name), profiles!shifts_created_by_fkey(full_name)")
          .order("shift_date", { ascending: true })
          .limit(1000),
        supabase.from("profiles").select("id").eq("role", "volunteer"),
      ]);
      setDepartments(depts || []);
      setShifts(shiftData || []);
      setStats({
        totalShifts: (shiftData || []).length,
        totalBookings: (shiftData || []).reduce((sum: number, s: any) => sum + s.booked_slots, 0),
        totalVolunteers: (vols || []).length,
      });
      setLoading(false);
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    let result = shifts;
    if (selectedDept !== "all") result = result.filter((s) => s.department_id === selectedDept);
    if (selectedStatus === "upcoming") {
      result = result.filter((s) => s.status === "open" || s.status === "full");
    } else if (selectedStatus !== "all") {
      result = result.filter((s) => s.status === selectedStatus);
    }
    if (dateFrom) result = result.filter((s) => s.shift_date >= dateFrom);
    if (dateTo) result = result.filter((s) => s.shift_date <= dateTo);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => s.title.toLowerCase().includes(q));
    }
    return result;
  }, [shifts, selectedDept, selectedStatus, dateFrom, dateTo, searchQuery]);

  const handleCancelShift = async (shift: any) => {
    setCancelLoading(true);
    // Get booked volunteers
    const { data: bookings } = await supabase
      .from("shift_bookings")
      .select("id, volunteer_id")
      .eq("shift_id", shift.id)
      .eq("booking_status", "confirmed");

    const bookedCount = bookings?.length || 0;

    // Cancel the shift
    const { error } = await supabase.from("shifts").update({ status: "cancelled" as any }).eq("id", shift.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setCancelLoading(false);
      setCancelPrompt(null);
      return;
    }

    // Cancel all bookings
    if (bookedCount > 0) {
      await supabase
        .from("shift_bookings")
        .update({ booking_status: "cancelled" as any, cancelled_at: new Date().toISOString() })
        .eq("shift_id", shift.id)
        .eq("booking_status", "confirmed");

      // Notify each volunteer
      const notifications = bookings!.map((b: any) => ({
        user_id: b.volunteer_id,
        type: "shift_cancelled",
        title: `Shift Cancelled — ${shift.title}`,
        message: `Your shift "${shift.title}" on ${format(parseShiftDate(shift.shift_date), "MMM d, yyyy")} at ${timeLabel(shift)} has been cancelled by the administrator.`,
        link: "/dashboard",
      }));
      await supabase.from("notifications").insert(notifications);
    }

    setShifts((prev) => prev.map((s) => s.id === shift.id ? { ...s, status: "cancelled" } : s));
    toast({ title: `Shift cancelled. ${bookedCount} volunteer${bookedCount !== 1 ? "s have" : " has"} been notified.` });
    setCancelLoading(false);
    setCancelPrompt(null);
  };

  const handleDeleteShift = async (shift: any) => {
    // Notify affected volunteers BEFORE the delete cascade wipes their bookings.
    // notifications.user_id is not FK-linked to shift_bookings, so these survive.
    const { data: affected } = await supabase
      .from("shift_bookings")
      .select("volunteer_id")
      .eq("shift_id", shift.id)
      .eq("booking_status", "confirmed");

    if (affected && affected.length > 0) {
      const shiftDateFormatted = format(new Date(shift.shift_date + "T00:00:00"), "MMM d, yyyy");
      const notifRows = affected.map((b: any) => ({
        user_id: b.volunteer_id,
        type: "shift_cancelled",
        title: `Shift Removed — ${shift.title}`,
        message: `Your booking for "${shift.title}" on ${shiftDateFormatted} has been removed by an administrator.`,
        link: "/dashboard",
      }));
      // Don't block delete on notification failure
      await supabase.from("notifications").insert(notifRows);
    }

    const { error } = await supabase.from("shifts").delete().eq("id", shift.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setShifts((prev) => prev.filter((s) => s.id !== shift.id));
      const suffix = affected && affected.length > 0
        ? ` ${affected.length} volunteer${affected.length !== 1 ? "s have" : " has"} been notified.`
        : "";
      toast({ title: `Shift permanently deleted.${suffix}` });
    }
    setDeletePrompt(null);
  };

  const handleExportAll = async () => {
    const { data: allBookings } = await supabase
      .from("shift_bookings")
      .select("*, profiles(full_name, email), shifts(title, shift_date, time_type, start_time, end_time, departments(name))")
      .eq("confirmation_status", "confirmed")
      .limit(1000);
    if (!allBookings) return;
    const csvData = allBookings.map((b: any) => ({
      Volunteer: b.profiles?.full_name || "",
      Email: b.profiles?.email || "",
      Shift: b.shifts?.title || "",
      Date: b.shifts?.shift_date || "",
      Department: b.shifts?.departments?.name || "",
      Time: b.shifts ? timeLabel(b.shifts) : "",
    }));
    downloadCSV(csvData, `all_hours_${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Admin Dashboard</h2>
        <Button variant="outline" size="sm" onClick={handleExportAll}>
          <Download className="h-4 w-4 mr-1" />Export All Hours
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{stats.totalShifts}</div><p className="text-sm text-muted-foreground">Total Shifts</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{stats.totalBookings}</div><p className="text-sm text-muted-foreground">Total Bookings</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{stats.totalVolunteers}</div><p className="text-sm text-muted-foreground">Volunteers</p></CardContent></Card>
      </div>

      {/* Top Volunteers Leaderboard */}
      <VolunteerLeaderboard />

      {/* Filters */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">All Shifts</h3>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <div className="relative flex-1 sm:min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="full">Full</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-[150px]" placeholder="From" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-[150px]" placeholder="To" />
        </div>
      </div>

      {/* Shift List */}
      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading shifts...</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No shifts match your filters.</p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s) => (
            <Card key={s.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="font-medium truncate">{s.title}</div>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(parseShiftDate(s.shift_date), "MMM d, yyyy")}
                      </span>
                      <span>{timeLabel(s)}</span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {s.booked_slots}/{s.total_slots}
                      </span>
                      {s.profiles?.full_name && (
                        <span className="text-xs">by {s.profiles.full_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-2 sm:flex-shrink-0">
                    <Badge className={`border ${deptBadgeClass(s.departments?.name)}`}>
                      {s.departments?.name}
                    </Badge>
                    <Badge variant={STATUS_BADGE[s.status] as any || "secondary"}>
                      {s.status}
                    </Badge>
                    {(s.status === "open" || s.status === "full") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => setCancelPrompt(s)}
                      >
                        <XCircle className="h-4 w-4 mr-1" />Cancel
                      </Button>
                    )}
                    {s.status === "cancelled" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setDeletePrompt(s)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DepartmentCoordinatorManager />

      {/* Cancel Dialog */}
      <AlertDialog open={!!cancelPrompt} onOpenChange={(open) => !open && setCancelPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling <strong>{cancelPrompt?.title}</strong> on{" "}
              {cancelPrompt && format(parseShiftDate(cancelPrompt.shift_date), "MMM d, yyyy")} will notify all{" "}
              {cancelPrompt?.booked_slots || 0} booked volunteer{cancelPrompt?.booked_slots !== 1 ? "s" : ""} that the shift has been cancelled. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelLoading}>Keep Shift</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelPrompt && handleCancelShift(cancelPrompt)}
              disabled={cancelLoading}
            >
              {cancelLoading ? "Cancelling..." : "Cancel Shift"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={!!deletePrompt} onOpenChange={(open) => !open && setDeletePrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Shift?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deletePrompt?.title}</strong> and all associated booking records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletePrompt && handleDeleteShift(deletePrompt)}
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
