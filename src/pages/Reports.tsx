import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/DatePicker";
import {
  TrendingUp, Star, Users, Calendar, Download, BarChart3,
  CheckCircle2, XCircle, Flame, AlertCircle,
} from "lucide-react";
import { format, subDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { downloadCSV } from "@/lib/calendar-utils";
import { useToast } from "@/hooks/use-toast";

interface Department {
  id: string;
  name: string;
}

interface ShiftRow {
  id: string;
  title: string;
  shift_date: string;
  department_id: string;
  total_slots: number;
  departments: { name: string } | null;
}

interface PopularityRow {
  shift_id: string;
  confirmed_count: number;
  waitlist_count: number;
  view_count: number;
  fill_ratio: number;
  popularity_score: number;
}

interface ConsistencyRow {
  shift_id: string;
  total_bookings: number;
  attended: number;
  no_shows: number;
  cancelled: number;
  attendance_rate: number;
}

interface RatingRow {
  shift_id: string;
  avg_rating: number;
  rating_count: number;
}

interface DepartmentReportRow {
  department_id: string;
  department_name: string;
  total_shifts: number;
  total_confirmed: number;
  total_no_shows: number;
  total_cancellations: number;
  total_waitlisted: number;
  avg_fill_rate: number;
  attendance_rate: number;
  rated_shift_count: number;
  avg_rating: number;
}

const PIE_COLORS = ["#006B3E", "#cf4b04", "#ffa300", "#94a3b8"];

export default function Reports() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [popularity, setPopularity] = useState<Record<string, PopularityRow>>({});
  const [consistency, setConsistency] = useState<Record<string, ConsistencyRow>>({});
  const [ratings, setRatings] = useState<Record<string, RatingRow>>({});
  const [departmentReport, setDepartmentReport] = useState<DepartmentReportRow[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(true);

  // Fetch departments + shifts in date range
  useEffect(() => {
    const fetchBase = async () => {
      setLoading(true);

      // Departments — coordinators only see their own
      let deptQuery = supabase.from("departments").select("id, name").eq("is_active", true).order("name");
      if (role === "coordinator") {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: myDepts } = await supabase
            .from("department_coordinators")
            .select("department_id")
            .eq("coordinator_id", user.id);
          const ids = (myDepts || []).map((d: any) => d.department_id);
          if (ids.length > 0) deptQuery = deptQuery.in("id", ids);
          else { setDepartments([]); setLoading(false); return; }
        }
      }
      const { data: depts } = await deptQuery;
      setDepartments(depts || []);

      // Shifts in range
      let shiftQuery = supabase
        .from("shifts")
        .select("id, title, shift_date, department_id, total_slots, departments(name)")
        .gte("shift_date", dateFrom)
        .lte("shift_date", dateTo)
        .order("shift_date", { ascending: false });
      if (role === "coordinator" && depts && depts.length > 0) {
        shiftQuery = shiftQuery.in("department_id", depts.map((d) => d.id));
      }
      const { data: shiftData } = await shiftQuery;
      const allShifts = (shiftData || []) as unknown as ShiftRow[];
      setShifts(allShifts);

      const shiftIds = allShifts.map((s) => s.id);

      if (shiftIds.length > 0) {
        // Popularity
        const { data: popData } = await (supabase as any).rpc("get_shift_popularity", { shift_uuids: shiftIds });
        const popMap: Record<string, PopularityRow> = {};
        for (const row of popData || []) popMap[row.shift_id] = row;
        setPopularity(popMap);

        // Consistency
        const { data: consData } = await (supabase as any).rpc("get_shift_consistency", { shift_uuids: shiftIds });
        const consMap: Record<string, ConsistencyRow> = {};
        for (const row of consData || []) consMap[row.shift_id] = row;
        setConsistency(consMap);

        // Ratings (privacy-enforced 2+ minimum already)
        const { data: ratingData } = await (supabase as any).rpc("get_shift_rating_aggregates", { shift_uuids: shiftIds });
        const ratingMap: Record<string, RatingRow> = {};
        for (const row of ratingData || []) {
          ratingMap[row.shift_id] = {
            shift_id: row.shift_id,
            avg_rating: Number(row.avg_rating),
            rating_count: row.rating_count,
          };
        }
        setRatings(ratingMap);
      }

      // Department-level rollup
      if (depts && depts.length > 0) {
        const { data: deptReport } = await (supabase as any).rpc("get_department_report", {
          dept_uuids: depts.map((d) => d.id),
          date_from: dateFrom,
          date_to: dateTo,
        });
        setDepartmentReport((deptReport || []) as DepartmentReportRow[]);
      }

      setLoading(false);
    };
    fetchBase();
  }, [role, dateFrom, dateTo]);

  // Filter shifts by selected department
  const filteredShifts = useMemo(() => {
    if (selectedDept === "all") return shifts;
    return shifts.filter((s) => s.department_id === selectedDept);
  }, [shifts, selectedDept]);

  // Top 10 most popular shifts
  const topPopular = useMemo(() => {
    return [...filteredShifts]
      .filter((s) => popularity[s.id])
      .sort((a, b) => (popularity[b.id]?.popularity_score || 0) - (popularity[a.id]?.popularity_score || 0))
      .slice(0, 10);
  }, [filteredShifts, popularity]);

  // Top 10 highest-rated shifts
  const topRated = useMemo(() => {
    return [...filteredShifts]
      .filter((s) => ratings[s.id])
      .sort((a, b) => (ratings[b.id]?.avg_rating || 0) - (ratings[a.id]?.avg_rating || 0))
      .slice(0, 10);
  }, [filteredShifts, ratings]);

  // Worst attendance shifts (highest no-show rate)
  const worstAttendance = useMemo(() => {
    return [...filteredShifts]
      .filter((s) => consistency[s.id] && consistency[s.id].total_bookings >= 3)
      .sort((a, b) => (consistency[a.id]?.attendance_rate || 100) - (consistency[b.id]?.attendance_rate || 100))
      .slice(0, 10);
  }, [filteredShifts, consistency]);

  // Aggregate counts for the overview pie chart
  const overviewData = useMemo(() => {
    let confirmed = 0, noShow = 0, cancelled = 0, waitlisted = 0;
    for (const s of filteredShifts) {
      const c = consistency[s.id];
      const p = popularity[s.id];
      if (c) {
        confirmed += c.attended;
        noShow += c.no_shows;
        cancelled += c.cancelled;
      }
      if (p) waitlisted += p.waitlist_count;
    }
    return [
      { name: "Attended", value: confirmed },
      { name: "No-show", value: noShow },
      { name: "Cancelled", value: cancelled },
      { name: "Waitlisted", value: waitlisted },
    ].filter((d) => d.value > 0);
  }, [filteredShifts, consistency, popularity]);

  // Department rollup filtered by selected department
  const visibleDepartmentReport = useMemo(() => {
    if (selectedDept === "all") return departmentReport;
    return departmentReport.filter((d) => d.department_id === selectedDept);
  }, [departmentReport, selectedDept]);

  // Summary stats
  const summary = useMemo(() => {
    const totalShifts = filteredShifts.length;
    let totalConfirmedBookings = 0;          // pre-event bookings (for fill %)
    let totalAttended = 0, totalNoShows = 0; // post-event (for attendance %)
    let totalSlots = 0;
    let ratedCount = 0, ratingSum = 0;
    for (const s of filteredShifts) {
      const c = consistency[s.id];
      const p = popularity[s.id];
      if (c) {
        totalAttended += c.attended;
        totalNoShows += c.no_shows;
      }
      if (p) {
        totalConfirmedBookings += p.confirmed_count;
      }
      totalSlots += s.total_slots;
      const r = ratings[s.id];
      if (r) {
        ratedCount += 1;
        ratingSum += r.avg_rating;
      }
    }
    const fillRate = totalSlots > 0 ? Math.round((totalConfirmedBookings / totalSlots) * 100) : 0;
    const attendRate = totalAttended + totalNoShows > 0 ? Math.round((totalAttended / (totalAttended + totalNoShows)) * 100) : 0;
    const avgRating = ratedCount > 0 ? +(ratingSum / ratedCount).toFixed(1) : 0;
    return { totalShifts, fillRate, attendRate, avgRating, ratedCount };
  }, [filteredShifts, consistency, popularity, ratings]);

  const handleExport = () => {
    if (filteredShifts.length === 0) {
      toast({ variant: "destructive", title: "No data", description: "Adjust the filters to include shifts." });
      return;
    }
    const data = filteredShifts.map((s) => {
      const c = consistency[s.id];
      const p = popularity[s.id];
      const r = ratings[s.id];
      return {
        Date: s.shift_date,
        Shift: s.title,
        Department: s.departments?.name || "",
        "Total Slots": s.total_slots,
        Confirmed: p?.confirmed_count ?? 0,
        Waitlisted: p?.waitlist_count ?? 0,
        Views: p?.view_count ?? 0,
        "Fill %": p && s.total_slots > 0 ? Math.round((p.confirmed_count / s.total_slots) * 100) : 0,
        Attended: c?.attended ?? 0,
        "No Shows": c?.no_shows ?? 0,
        Cancelled: c?.cancelled ?? 0,
        "Attendance Rate %": c?.attendance_rate ?? 0,
        "Popularity Score": p?.popularity_score ?? 0,
        "Avg Rating": r?.avg_rating ?? "—",
        "Rating Count": r?.rating_count ?? 0,
      };
    });
    downloadCSV(data, `shift_reports_${format(new Date(), "yyyy-MM-dd")}.csv`);
    toast({ title: "Export complete", description: `Downloaded ${data.length} shifts.` });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Reports
          </h1>
          <p className="text-muted-foreground text-sm">
            Analytics across shifts, ratings, popularity and attendance.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={loading || filteredShifts.length === 0}>
          <Download className="h-4 w-4 mr-2" />Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Department</label>
            <Select value={selectedDept} onValueChange={setSelectedDept}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">From</label>
            <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Start date" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">To</label>
            <DatePicker value={dateTo} onChange={setDateTo} placeholder="End date" />
          </div>
        </CardContent>
      </Card>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard icon={<Calendar className="h-5 w-5 text-primary" />} label="Total Shifts" value={summary.totalShifts.toString()} />
        <SummaryCard icon={<TrendingUp className="h-5 w-5 text-primary" />} label="Fill Rate" value={`${summary.fillRate}%`} />
        <SummaryCard icon={<CheckCircle2 className="h-5 w-5 text-primary" />} label="Attendance" value={`${summary.attendRate}%`} />
        <SummaryCard icon={<Star className="h-5 w-5 text-primary" />} label="Avg Rating" value={summary.avgRating > 0 ? `${summary.avgRating}★` : "—"} subtitle={`${summary.ratedCount} rated`} />
      </div>

      {loading ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Loading reports...</CardContent></Card>
      ) : filteredShifts.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">No shifts in the selected range.</CardContent></Card>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="popularity">Popularity</TabsTrigger>
            <TabsTrigger value="ratings">Ratings</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
          </TabsList>

          {/* Overview tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Outcome Breakdown</CardTitle>
                  <CardDescription>How shifts in this range played out</CardDescription>
                </CardHeader>
                <CardContent>
                  {overviewData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No outcome data yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={overviewData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                          {overviewData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Department Rollup</CardTitle>
                  <CardDescription>Aggregated metrics per department</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[280px] overflow-y-auto">
                  {visibleDepartmentReport.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No data.</p>
                  ) : (
                    visibleDepartmentReport.map((d) => (
                      <div key={d.department_id} className="flex items-center justify-between text-sm border-b pb-2">
                        <div>
                          <p className="font-medium">{d.department_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.total_shifts} shifts · {d.total_confirmed} confirmed · {d.total_no_shows} no-shows
                          </p>
                        </div>
                        <div className="text-right text-xs">
                          <p>Fill: <strong>{d.avg_fill_rate}%</strong></p>
                          <p>Attend: <strong>{d.attendance_rate}%</strong></p>
                          {d.rated_shift_count > 0 && (
                            <p>Rating: <strong>{d.avg_rating}★</strong> ({d.rated_shift_count})</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Popularity tab */}
          <TabsContent value="popularity" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Flame className="h-4 w-4 text-orange-500" /> Top 10 Most Popular Shifts
                </CardTitle>
                <CardDescription>
                  Score = fill rate × 1.0 + waitlist count × 0.1 + min(views÷20, 1.0) × 0.2
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topPopular.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No popularity data yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(240, topPopular.length * 32)}>
                    <BarChart data={topPopular.map((s) => ({
                      name: `${s.title.slice(0, 28)}${s.title.length > 28 ? "…" : ""}`,
                      score: popularity[s.id]?.popularity_score || 0,
                      waitlist: popularity[s.id]?.waitlist_count || 0,
                    }))} layout="vertical" margin={{ left: 100 }}>
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" width={150} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="score" fill="#cf4b04" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Popularity Detail</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[400px] overflow-y-auto">
                {topPopular.map((s) => {
                  const p = popularity[s.id];
                  return (
                    <div key={s.id} className="flex items-center justify-between text-sm border-b pb-2">
                      <div>
                        <p className="font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")} · {s.departments?.name}
                        </p>
                      </div>
                      <div className="text-right text-xs space-y-0.5">
                        <p><Badge variant="secondary">{p?.popularity_score}</Badge></p>
                        <p>{p?.confirmed_count}/{s.total_slots} filled</p>
                        {p && p.waitlist_count > 0 && <p className="text-orange-500">+{p.waitlist_count} waitlist</p>}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Ratings tab */}
          <TabsContent value="ratings" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-500" /> Top 10 Highest-Rated Shifts
                </CardTitle>
                <CardDescription>
                  Aggregate ratings only — requires at least 2 volunteers to have rated each shift.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topRated.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No shifts have 2+ ratings in this range yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(240, topRated.length * 32)}>
                    <BarChart data={topRated.map((s) => ({
                      name: `${s.title.slice(0, 28)}${s.title.length > 28 ? "…" : ""}`,
                      rating: ratings[s.id]?.avg_rating || 0,
                    }))} layout="vertical" margin={{ left: 100 }}>
                      <XAxis type="number" domain={[0, 5]} />
                      <YAxis type="category" dataKey="name" width={150} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="rating" fill="#ffa300" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Attendance tab */}
          <TabsContent value="attendance" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" /> Lowest Attendance Rate (3+ bookings)
                </CardTitle>
                <CardDescription>
                  Shifts with the worst attendance — useful for identifying problem time slots or recurring no-show issues.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {worstAttendance.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No shifts with sufficient bookings yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {worstAttendance.map((s) => {
                      const c = consistency[s.id];
                      return (
                        <div key={s.id} className="flex items-center justify-between text-sm border-b pb-2">
                          <div>
                            <p className="font-medium">{s.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")} · {s.departments?.name}
                            </p>
                          </div>
                          <div className="text-right text-xs space-y-0.5">
                            <p>
                              <Badge variant={c && c.attendance_rate >= 80 ? "default" : "destructive"}>
                                {c?.attendance_rate}%
                              </Badge>
                            </p>
                            <p>
                              {c?.attended}/{c?.total_bookings} attended
                              {c && c.no_shows > 0 && <span className="text-destructive"> · {c.no_shows} no-show</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, subtitle }: { icon: React.ReactNode; label: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs font-medium text-muted-foreground">{label}</span></div>
        <p className="text-2xl font-bold">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
