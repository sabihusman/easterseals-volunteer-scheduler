import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar as CalendarIcon, Clock, Shield, Users, List, CalendarDays, AlertTriangle, Sparkles, Filter } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { timeLabel } from "@/lib/calendar-utils";
import { InviteFriendModal } from "@/components/InviteFriendModal";
import { SlotSelectionDialog } from "@/components/SlotSelectionDialog";
import { RecommendedShifts } from "@/components/RecommendedShifts";
import { useInteractionTracking } from "@/hooks/useInteractionTracking";

interface ShiftRow {
  id: string;
  title: string;
  shift_date: string;
  department_id: string;
  status: string;
  total_slots: number;
  booked_slots: number;
  requires_bg_check: boolean;
  time_type: string;
  start_time: string | null;
  end_time: string | null;
  departments: { name: string; requires_bg_check?: boolean } | null;
}

interface ShiftCardProps {
  s: ShiftRow;
  bookingIds: Set<string>;
  profile: { booking_privileges?: boolean; bg_check_status?: string } | null;
  privilegesSuspended: boolean;
  setSlotDialogShift: (shift: ShiftRow) => void;
  trackViewed: (shiftId: string) => void;
}

function ShiftCard({ s, bookingIds, profile, privilegesSuspended, setSlotDialogShift, trackViewed }: ShiftCardProps) {
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
              <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
              <span className="flex items-center gap-1"><Users className="h-3 w-3" />{isFull ? "Full" : `${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} left`}</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-xs">{s.departments?.name}</Badge>
              {s.requires_bg_check && <Badge variant="outline" className="text-xs"><Shield className="h-3 w-3 mr-1" />BG Check Required</Badge>}
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {alreadyBooked && !s.requires_bg_check && !s.departments?.requires_bg_check && (
              <InviteFriendModal shiftId={s.id} shiftTitle={s.title} shiftDate={s.shift_date} shiftTime={timeLabel(s)} />
            )}
            <Button
              size="sm"
              disabled={alreadyBooked || !profile?.booking_privileges || privilegesSuspended}
              onClick={() => { setSlotDialogShift(s); trackViewed(s.id); }}
            >
              {alreadyBooked ? "Booked" : isFull ? "Join Waitlist" : "Book Shift"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BrowseShifts() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { trackViewed, trackSignedUp, trackCancelled } = useInteractionTracking();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [hiddenBgCount, setHiddenBgCount] = useState(0);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<"1w" | "2w" | "3w" | "1m">("2w");
  const [loading, setLoading] = useState(true);
  const [bookingIds, setBookingIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calMonth, setCalMonth] = useState(new Date());
  const [slotDialogShift, setSlotDialogShift] = useState<ShiftRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Booking window based on consistency score
  const extendedBooking = profile?.extended_booking === true;
  const maxBookingDays = extendedBooking ? 21 : 14;
  const consistencyScore = profile?.consistency_score ?? 0;

  const fetchData = useCallback(async () => {
    // Calculate max booking date based on profile
    const maxDays = profile?.extended_booking ? 21 : 14;
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDays);
    const maxDateStr = format(maxDate, "yyyy-MM-dd");
    const todayStr = format(new Date(), "yyyy-MM-dd");

    // Fetch all candidate shifts within the booking window (from today onward).
    // The definitive "not yet ended" filter is applied client-side below so we
    // can handle time_type defaults (morning/afternoon/all_day) and local TZ
    // correctly.
    const [{ data: depts }, { data: shiftData }, { data: myBookings }, restrictionResult] = await Promise.all([
      supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("shifts")
        .select("*, departments(name, requires_bg_check)")
        .gte("shift_date", todayStr)
        .lte("shift_date", maxDateStr)
        .in("status", ["open", "full"])
        .order("shift_date", { ascending: true })
        .order("start_time", { ascending: true, nullsFirst: false }),
      user
        ? supabase.from("shift_bookings").select("shift_id").eq("volunteer_id", user.id).in("booking_status", ["confirmed", "waitlisted"])
        : Promise.resolve({ data: [] }),
      user
        ? supabase.from("department_restrictions").select("department_id").eq("volunteer_id", user.id)
        : Promise.resolve({ data: [] }),
    ]);
    const restrictedDeptIds = new Set((restrictionResult.data || []).map((r: { department_id: string }) => r.department_id));

    // Compute each shift's end datetime in local time, honoring time_type
    // defaults when end_time is null. A shift is bookable only until its
    // end time has passed.
    const shiftEndAt = (s: ShiftRow): Date => {
      const endStr =
        s.end_time ||
        (s.time_type === "morning"
          ? "12:00:00"
          : s.time_type === "afternoon"
          ? "16:00:00"
          : "17:00:00");
      return new Date(`${s.shift_date}T${endStr}`);
    };
    const now = new Date();

    // Build a set of shift IDs the user has already booked (confirmed or waitlisted)
    const alreadyBookedIds = new Set((myBookings || []).map((b: { shift_id: string }) => b.shift_id));

    // Count BG-gated shifts that would be hidden BEFORE filtering, so the
    // banner shows even when every relevant shift was filtered out.
    const bgStatus = profile?.bg_check_status;
    const rawShifts = ((shiftData || []) as ShiftRow[])
      .filter((s) => !restrictedDeptIds.has(s.department_id))
      // Drop shifts whose end time has already passed
      .filter((s) => shiftEndAt(s) > now)
      // Hide shifts the user has already booked so they don't see them twice
      .filter((s) => !alreadyBookedIds.has(s.id));
    const bgHidden = rawShifts.filter((s) =>
      (s.requires_bg_check || s.departments?.requires_bg_check) && bgStatus !== "cleared"
    ).length;
    setHiddenBgCount(bgHidden);

    // Filter out restricted depts and BG-check-required shifts if volunteer not cleared
    const filteredShifts = rawShifts.filter((s) => {
      if ((s.requires_bg_check || s.departments?.requires_bg_check) && bgStatus !== "cleared") return false;
      return true;
    });

    setDepartments((depts || []).filter((d) => !restrictedDeptIds.has(d.id)));
    setShifts(filteredShifts);
    setBookingIds(alreadyBookedIds);
    setLoading(false);
  }, [user, profile?.extended_booking, profile?.bg_check_status]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // If extended booking is not available, clamp time range to "2w"
  useEffect(() => {
    if (!extendedBooking && (timeRange === "3w" || timeRange === "1m")) {
      setTimeRange("2w");
    }
  }, [extendedBooking, timeRange]);

  const handleBooked = () => {
    fetchData();
    setRefreshKey((k) => k + 1);
  };

  // Apply department + time range filters
  const timeRangeDays: Record<typeof timeRange, number> = { "1w": 7, "2w": 14, "3w": 21, "1m": 30 };
  const rangeLimit = new Date();
  rangeLimit.setDate(rangeLimit.getDate() + timeRangeDays[timeRange]);
  const rangeLimitStr = format(rangeLimit, "yyyy-MM-dd");

  const filtered = shifts.filter((s) => {
    if (selectedDept !== "all" && s.department_id !== selectedDept) return false;
    if (s.shift_date > rangeLimitStr) return false;
    return true;
  });

  const monthStart = startOfMonth(calMonth);
  const monthEnd = endOfMonth(calMonth);
  const calendarDays = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });

  const getShiftsForDay = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return filtered.filter((s) => s.shift_date === dateStr);
  };

  const privilegesSuspended = profile?.booking_privileges === false;
  const bgNotCleared = profile?.bg_check_status !== "cleared";
  const bgFailed = profile?.bg_check_status === "failed" || profile?.bg_check_status === "expired";
  // Show banner whenever any BG-gated shifts were hidden, regardless of remaining list
  const hasBgGatedShiftsHidden = bgNotCleared && hiddenBgCount > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {privilegesSuspended && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Booking Privileges Suspended</AlertTitle>
          <AlertDescription>Your booking privileges have been suspended. Contact your coordinator.</AlertDescription>
        </Alert>
      )}

      {!privilegesSuspended && bgFailed && (
        <Alert className="border-warning/50 bg-warning/10 text-warning-foreground">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Background Check {profile?.bg_check_status === "expired" ? "Expired" : "Failed"}</AlertTitle>
          <AlertDescription>Some shifts are hidden because they require a cleared background check.</AlertDescription>
        </Alert>
      )}

      {!privilegesSuspended && !bgFailed && bgNotCleared && hasBgGatedShiftsHidden && (
        <Alert className="border-warning/50 bg-warning/10 text-warning-foreground">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Background Check Pending</AlertTitle>
          <AlertDescription>Some shifts are hidden because they require a cleared background check.</AlertDescription>
        </Alert>
      )}

      {/* Eligibility banner — shows consistency score and booking window */}
      {!privilegesSuspended && profile && (
        <div className={`rounded-lg border p-3 flex items-start gap-3 ${
          extendedBooking
            ? "border-primary/30 bg-primary/5"
            : "border-muted bg-muted/30"
        }`}>
          <Sparkles className={`h-5 w-5 mt-0.5 shrink-0 ${extendedBooking ? "text-primary" : "text-muted-foreground"}`} />
          <div className="flex-1 text-sm">
            {extendedBooking ? (
              <>
                <p className="font-medium text-foreground">
                  Extended booking unlocked — book up to <strong>3 weeks</strong> in advance
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Your consistency score is {consistencyScore}% over your last 5 shifts. Keep it above 90% to retain this perk.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">
                  Standard booking window — 2 weeks in advance
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {consistencyScore > 0
                    ? `Your consistency score is ${consistencyScore}%. Reach 90% over your last 5 shifts to unlock a 3-week booking window.`
                    : "Complete 5 shifts with a 90% attendance rate to unlock a 3-week booking window."}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Available Shifts</h2>
          <p className="text-muted-foreground">Browse and book volunteer shifts</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-1" />
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as "1w" | "2w" | "3w" | "1m")}>
            <SelectTrigger className="w-[160px]">
              <CalendarIcon className="h-4 w-4 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1w">Within 1 week</SelectItem>
              <SelectItem value="2w">Within 2 weeks</SelectItem>
              <SelectItem value="3w" disabled={!extendedBooking}>
                Within 3 weeks{!extendedBooking && " 🔒"}
              </SelectItem>
              <SelectItem value="1m" disabled={!extendedBooking}>
                Within 1 month{!extendedBooking && " 🔒"}
              </SelectItem>
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
      ) : privilegesSuspended ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Your booking privileges have been suspended. Contact your coordinator.</CardContent></Card>
      ) : view === "list" ? (
        <>
          {!privilegesSuspended && (
            <RecommendedShifts
              refreshKey={refreshKey}
              onBookShift={(shiftId, shiftData) => {
                if (shiftData) {
                  setSlotDialogShift({
                    id: shiftData.shift_id,
                    title: shiftData.title,
                    shift_date: shiftData.shift_date,
                    department_id: '',
                    departments: {
                      name: shiftData.department_name,
                      requires_bg_check: shiftData.requires_bg_check,
                    },
                    status: 'open',
                    total_slots: shiftData.total_slots,
                    booked_slots: shiftData.booked_slots,
                    requires_bg_check: shiftData.requires_bg_check,
                    time_type: shiftData.time_type,
                    start_time: shiftData.start_time,
                    end_time: shiftData.end_time,
                  });
                  trackViewed(shiftId);
                }
              }}
            />
          )}
        {filtered.length === 0 ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">No available shifts found.</CardContent></Card>
        ) : (
          <div className="grid gap-3">
            {filtered.map((s) => <ShiftCard key={s.id} s={s} bookingIds={bookingIds} profile={profile} privilegesSuspended={privilegesSuspended} setSlotDialogShift={setSlotDialogShift} trackViewed={trackViewed} />)}
          </div>
        )}
        </>      ) : (
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
                          onClick={() => {
                            if (isBooked) return;
                            trackViewed(s.id);
                            setSlotDialogShift(s);
                          }}
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

      {/*
        Keyed by shift id so that clicking Book Shift on a different shift
        forces a clean remount instead of reusing a stale internal state
        that could have its open-transition in-flight.
      */}
      {slotDialogShift && (
        <SlotSelectionDialog
          key={slotDialogShift.id}
          open={!!slotDialogShift}
          onOpenChange={(open) => { if (!open) setSlotDialogShift(null); }}
          shift={slotDialogShift}
          onBooked={handleBooked}
        />
      )}
    </div>
  );
}
