import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Calendar, Clock, MapPin } from "lucide-react";
import { format } from "date-fns";
import type { MatchedShift } from "@/lib/checkin-actions";

interface Props {
  volunteerName: string;
  shifts: MatchedShift[];
  onCheckIn: (shift: MatchedShift) => void;
  onCheckInAll: () => void;
}

/**
 * Confirm-check-in screen. One tappable card per matched shift; if the
 * volunteer has multiple slots today, also shows a "Check In to All"
 * button at the bottom.
 */
export function ConfirmCheckinScreen({ volunteerName, shifts, onCheckIn, onCheckInAll }: Props) {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Confirm Check-In</CardTitle>
        <CardDescription>
          Welcome, {volunteerName}! {shifts.length === 1
            ? "Please confirm your shift check-in."
            : `You have ${shifts.length} slots today. Select one or check in to all.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {shifts.map((shift) => (
          <button
            key={shift.bookingId}
            onClick={() => onCheckIn(shift)}
            className="w-full text-left rounded-lg border p-4 hover:bg-muted transition-colors space-y-2"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">{shift.title}</p>
              <Badge variant="outline" className="text-xs">
                <MapPin className="h-3 w-3 mr-1" />
                {shift.departmentName}
              </Badge>
            </div>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(shift.shiftDate + "T00:00:00"), "MMM d, yyyy")}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {shift.startTime} - {shift.endTime}
              </span>
            </div>
            <div className="text-xs text-primary font-medium">Tap to check in</div>
          </button>
        ))}

        {shifts.length > 1 && (
          <Button className="w-full" onClick={onCheckInAll}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Check In to All {shifts.length} Slots
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
