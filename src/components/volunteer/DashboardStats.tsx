import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award } from "lucide-react";

const MILESTONE_BADGES = [10, 25, 50, 100];

interface Props {
  upcomingCount: number;
  hours: number;
  consistencyScore: number | null;
  points: number;
}

/**
 * 4-card KPI grid: upcoming shifts, total hours (with milestone badges),
 * consistency score, and points.
 */
export function DashboardStats({ upcomingCount, hours, consistencyScore, points }: Props) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold">{upcomingCount}</div>
          <p className="text-sm text-muted-foreground">Upcoming Shifts</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold">{hours}</div>
          <p className="text-sm text-muted-foreground">Total Hours</p>
          <div className="flex gap-1 mt-2">
            {MILESTONE_BADGES.map((m) => (
              <Badge key={m} variant={hours >= m ? "default" : "secondary"} className="text-[10px]">
                {hours >= m && <Award className="h-2.5 w-2.5 mr-0.5" />}{m}h
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold">
            {consistencyScore != null ? `${consistencyScore}%` : "—"}
          </div>
          <p className="text-sm text-muted-foreground">Consistency Score</p>
          <p className="text-xs text-muted-foreground mt-1">
            {consistencyScore != null ? "Based on last 5 shifts" : "Complete 5 shifts to see your score"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold">{points}</div>
          <p className="text-sm text-muted-foreground">Points</p>
        </CardContent>
      </Card>
    </div>
  );
}
