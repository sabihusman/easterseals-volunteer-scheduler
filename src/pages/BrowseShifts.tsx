import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar as CalendarIcon, Clock, Shield, Users, List, CalendarDays } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { timeLabel } from "@/lib/calendar-utils";
import { InviteFriendModal } from "@/components/InviteFriendModal";
import { SlotSelectionDialog } from "@/components/SlotSelectionDialog";

export default function BrowseShifts() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [shifts, setShifts] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [bookingIds, setBookingIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calMonth, setCalMonth] = useState(new Date());
  const [slotDialogShift, setSlotDialogShift] = useState<any>(null);

  const fetchData = async () => {
    // Calculate max booking date based on profile
    const maxDays = profile?.extended_booking ? 21 : 14;
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDays);
    const maxDateStr = maxDate.toISOString().split("T")[0];
    const todayStr = new Date().toISOString().split("T")[0];

    const [{ data: depts }, { data: shiftData }, { data: myBookings }, restrictionResult] = await Promise.all([
      supabase.from("departments").select("id, name").eq("is_active", true),
      supabase
        .from("shifts")
        .select("*, departments(name, requires_bg_check)")
        .gte("shift_date", todayStr)
        .lte("shift_date", maxDateStr)
        .in("status", ["open", "full"])
        .order("shift_date", { ascending: true }),
      user
        ? supabase.from("shift_bookings").select("shift_id").eq("volunteer_id", user.id).in("booking_status", ["confirmed", "waitlisted"])
        : Promise.resolve({ data: [] }),
      user
        ? supabase.from("department_restrictions").select("department_id").eq("volunteer_id", user.id)
        : Promise.resolve({ data: [] }),
    ]);
    const restrictedDeptIds = new Set((restrictionResult.data || []).map((r: any) => r.department_id));

    // Filter out restricted depts and BG-check-required shifts if volunteer not cleared
    const bgStatus = profile?.bg_check_status;
    const filteredShifts = (shiftData || []).filter((s: any) => {
      if (restrictedDeptIds.has(s.department_id)) return false;
      if ((s.requires_bg_check || s.departments?.requires_bg_check) && bgStatus !== "cleared") return false;
      return true;
    });

    setDepartments((depts || []).filter((d: any) => !restrictedDeptIds.has(d.id)));
    setShifts(filteredShifts);
    setBookingIds(new Set((myBookings || []).map((b: any) => b.shift_id)));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user, profile?.extended_booking, profile?.bg_check_status]);

  const handleBooked = () => {
    fetchData();
  };

  const filtered = selectedDept === "all" ? shifts : shifts.filter((s) => s.department_id === selectedDept);

  const monthStart = startOfMonth(calMonth);
  const monthEnd = endOfMonth(calMonth);
  const calendarDays = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });

  const getShiftsForDay = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return filtered.filter((s) => s.shift_date === dateStr);
  };

  const ShiftCard = ({ s }: { s: any }) => {
    const slotsLeft = s.total_slots - s.booked_slots;
    const isFull = slotsLeft <= 0;
    const alreadyBooked = bookingIds.has(s.id);
    return (
      <Card key={s.id}>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="font-medium">{s.title}</div>
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
                <span className="flex items-center gap-1"><Users className="h-3 w-3" />{isFull ? "Full" : `${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} left`}</span>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary" className="text-xs">{s.departments?.name}</Badge>
                {s.requires_bg_check && <Badge variant="outline" className="text-xs"><Shield className="h-3 w-3 mr-1" />BG Check Required</Badge>}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {alreadyBooked && !s.requires_bg_check && (
                <InviteFriendModal shiftId={s.id} shiftTitle={s.title} />
              )}
              <Button
                size="sm"
                disabled={alreadyBooked || !profile?.booking_privileges}
                onClick={() => setSlotDialogShift(s)}
              >
                {alreadyBooked ? "Booked" : isFull ? "Join Waitlist" : "Book Shift"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Available Shifts</h2>
          <p className="text-muted-foreground">Browse and book volunteer shifts</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tabs value={view} onValueChange={(v) => setView(v as "list" | "calendar")}>
            <TabsList>
              <TabsTrigger value="list" aria-label="List view"><List className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="calendar" aria-label="Calendar view"><CalendarDays className="h-4 w-4" /></TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading shifts...</p>
      ) : view === "list" ? (
        filtered.length === 0 ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">No available shifts found.</CardContent></Card>
        ) : (
          <div className="grid gap-3">
            {filtered.map((s) => <ShiftCard key={s.id} s={s} />)}
          </div>
        )
      ) : (
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
              const dayShifts = getShiftsForDay(day);
              const isCurrentMonth = isSameMonth(day, calMonth);
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={day.toISOString()}
                  className={`bg-card min-h-[80px] p-1.5 ${!isCurrentMonth ? "opacity-40" : ""} ${isToday ? "ring-2 ring-primary ring-inset" : ""}`}
                >
                  <div className="text-xs font-medium mb-1">{format(day, "d")}</div>
                  <div className="space-y-0.5">
                    {dayShifts.slice(0, 3).map((s) => {
                      const isBooked = bookingIds.has(s.id);
                      return (
                        <div
                          key={s.id}
                          className={`text-[10px] px-1 py-0.5 rounded truncate cursor-pointer ${
                            isBooked ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
                          }`}
                          title={`${s.title} - ${timeLabel(s)}`}
                          onClick={() => !isBooked && setSlotDialogShift(s)}
                        >
                          {s.title}
                        </div>
                      );
                    })}
                    {dayShifts.length > 3 && (
                      <div className="text-[10px] text-muted-foreground pl-1">+{dayShifts.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {slotDialogShift && (
        <SlotSelectionDialog
          open={!!slotDialogShift}
          onOpenChange={(open) => { if (!open) setSlotDialogShift(null); }}
          shift={slotDialogShift}
          onBooked={handleBooked}
        />
      )}
    </div>
  );
}
