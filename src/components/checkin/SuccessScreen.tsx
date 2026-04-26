import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import { format } from "date-fns";
import type { MatchedShift } from "@/lib/checkin-actions";

interface Props {
  volunteerName: string;
  /** Single shift checked in to (or null if multi-slot). */
  shift: MatchedShift | null;
  /** Total slots checked in to when multi-slot (used when `shift` is null). */
  multiSlotCount: number;
}

/**
 * Success screen shown after a successful check-in. Displays the single
 * shift's detail OR the "checked in to N slots" summary.
 */
export function SuccessScreen({ volunteerName, shift, multiSlotCount }: Props) {
  return (
    <Card className="border-green-500">
      <CardContent className="pt-6 text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
        <h3 className="text-xl font-bold text-green-700">You're Checked In!</h3>
        <p className="text-muted-foreground">
          Thank you, {volunteerName}! Your check-in has been recorded.
        </p>
        {shift && (
          <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
            <p className="font-medium">{shift.title}</p>
            <p className="text-muted-foreground">
              {shift.startTime} - {shift.endTime} | {shift.departmentName}
            </p>
          </div>
        )}
        {!shift && multiSlotCount > 1 && (
          <div className="rounded-md border bg-muted/50 p-3 text-sm">
            <p className="font-medium">Checked in to {multiSlotCount} slots</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Checked in at {format(new Date(), "h:mm a")}
        </p>
        <Button variant="outline" asChild>
          <Link to="/dashboard">Go to Dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
