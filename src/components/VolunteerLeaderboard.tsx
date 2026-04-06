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
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LeaderboardEntry {
  id: string;
  full_name: string;
  volunteer_points: number;
}

const MEDAL_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"];
const DEFAULT_COLOR = "#006B3E";

export function VolunteerLeaderboard() {
  const { user } = useAuth();
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [userPoints, setUserPoints] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, volunteer_points")
        .eq("role", "volunteer")
        .gt("volunteer_points", 0)
        .order("volunteer_points", { ascending: false })
        .limit(10);

      const top10 = (data as LeaderboardEntry[]) || [];
      setLeaders(top10);

      // Check if current user is in top 10
      if (user && top10.length > 0) {
        const inTop10 = top10.some((v) => v.id === user.id);
        if (!inTop10) {
          // Get user's rank
          const { count } = await supabase
            .from("profiles")
            .select("*", { count: "exact", head: true })
            .eq("role", "volunteer")
            .gt("volunteer_points", 0);

          const { data: userProfile } = await supabase
            .from("profiles")
            .select("volunteer_points")
            .eq("id", user.id)
            .single();

          if (userProfile && userProfile.volunteer_points > 0) {
            const { count: aboveCount } = await supabase
              .from("profiles")
              .select("*", { count: "exact", head: true })
              .eq("role", "volunteer")
              .gt("volunteer_points", userProfile.volunteer_points);

            setUserRank((aboveCount || 0) + 1);
            setUserPoints(userProfile.volunteer_points);
          }
        }
      }

      setLoading(false);
    };

    fetchLeaderboard();
  }, [user]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Volunteers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (leaders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Volunteers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">No data yet</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = [...leaders].reverse().map((v) => ({
    name: v.full_name || "Anonymous",
    points: v.volunteer_points,
    id: v.id,
  }));

  const getBarColor = (index: number) => {
    // chartData is reversed so index 0 is the lowest rank in top 10
    const rank = leaders.length - 1 - index;
    if (rank < 3) return MEDAL_COLORS[rank];
    return DEFAULT_COLOR;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Volunteers</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(300, leaders.length * 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value: number) => [`${value} pts`, "Points"]} />
            <Bar dataKey="points" radius={[0, 4, 4, 0]}>
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(index)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {userRank !== null && (
          <p className="text-sm text-muted-foreground text-center mt-4 border-t pt-3">
            Your rank: <span className="font-semibold">#{userRank}</span> with{" "}
            <span className="font-semibold">{userPoints} pts</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
