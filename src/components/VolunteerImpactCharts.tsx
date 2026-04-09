import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, subMonths, startOfMonth } from "date-fns";

interface MonthlyHours {
  month: string;
  hours: number;
}

interface MonthlyStatus {
  month: string;
  confirmed: number;
  no_show: number;
}

export function VolunteerImpactCharts() {
  const { user } = useAuth();
  const [hoursData, setHoursData] = useState<MonthlyHours[]>([]);
  const [statusData, setStatusData] = useState<MonthlyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchImpactData = async () => {
      const now = new Date();
      const sixMonthsAgo = startOfMonth(subMonths(now, 5));
      const fromDate = format(sixMonthsAgo, "yyyy-MM-dd");

      // Fetch confirmed bookings with shifts for the last 6 months.
      // Must filter booking_status = 'confirmed' too — otherwise a
      // booking that was cancelled AFTER the volunteer was marked
      // confirmation_status='confirmed' (e.g. admin cancelled the
      // shift) still counts as impact, inflating the monthly totals.
      const { data: bookings } = await supabase
        .from("shift_bookings")
        .select("confirmation_status, final_hours, shifts(shift_date)")
        .eq("volunteer_id", user.id)
        .eq("booking_status", "confirmed")
        .gte("shifts.shift_date", fromDate)
        .in("confirmation_status", ["confirmed", "no_show"]);

      if (!bookings || bookings.length === 0) {
        setHasData(false);
        setLoading(false);
        return;
      }

      // Build month buckets
      const monthBuckets: Record<string, { hours: number; confirmed: number; no_show: number }> = {};
      for (let i = 5; i >= 0; i--) {
        const monthDate = subMonths(now, i);
        const key = format(startOfMonth(monthDate), "yyyy-MM");
        monthBuckets[key] = { hours: 0, confirmed: 0, no_show: 0 };
      }

      let anyConfirmed = false;
      for (const b of bookings) {
        const shiftDate = (b.shifts as any)?.shift_date;
        if (!shiftDate) continue;

        const monthKey = shiftDate.substring(0, 7); // "yyyy-MM"
        if (!(monthKey in monthBuckets)) continue;

        if (b.confirmation_status === "confirmed") {
          monthBuckets[monthKey].hours += b.final_hours || 0;
          monthBuckets[monthKey].confirmed += 1;
          anyConfirmed = true;
        } else if (b.confirmation_status === "no_show") {
          monthBuckets[monthKey].no_show += 1;
        }
      }

      if (!anyConfirmed) {
        setHasData(false);
        setLoading(false);
        return;
      }

      setHasData(true);

      const sortedKeys = Object.keys(monthBuckets).sort();
      setHoursData(
        sortedKeys.map((key) => ({
          month: format(new Date(key + "-01"), "MMM yyyy"),
          hours: Math.round(monthBuckets[key].hours * 10) / 10,
        }))
      );
      setStatusData(
        sortedKeys.map((key) => ({
          month: format(new Date(key + "-01"), "MMM yyyy"),
          confirmed: monthBuckets[key].confirmed,
          no_show: monthBuckets[key].no_show,
        }))
      );

      setLoading(false);
    };

    fetchImpactData();
  }, [user]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center py-4">Loading impact data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!hasData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center py-4">No data yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hours by Month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={hoursData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value: number) => [`${value} hrs`, "Hours"]} />
            <Bar dataKey="hours" fill="#006B3E" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <div>
          <h4 className="text-base font-semibold mb-3">Confirmed vs No-Shows</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={statusData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="confirmed" stackId="a" fill="#006B3E" name="Confirmed" radius={[0, 0, 0, 0]} />
              <Bar dataKey="no_show" stackId="a" fill="#d1d5db" name="No-Show" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
