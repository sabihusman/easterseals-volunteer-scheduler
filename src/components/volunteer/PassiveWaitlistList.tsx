import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import type { VolunteerBooking } from "@/hooks/useVolunteerBookings";

interface Props {
  items: VolunteerBooking[];
  onLeave: (bookingId: string) => void;
}

/**
 * "Your Waitlist" card listing shifts the volunteer is waitlisted on
 * without an active offer. Offers a "Leave Waitlist" button per row.
 */
export function PassiveWaitlistList({ items, onLeave }: Props) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" /> Your Waitlist
        </CardTitle>
        <CardDescription className="text-xs">
          You'll be notified if a spot opens up on any of these shifts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((w) => {
          const s = w.shifts;
          return (
            <div key={w.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-md bg-muted/50">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{s?.title}</p>
                <p className="text-xs text-muted-foreground">
                  {s && format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")}
                  {s?.departments?.name ? ` · ${s.departments.name}` : ""}
                  {s && ` · ${s.booked_slots}/${s.total_slots} filled`}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onLeave(w.id)}>
                Leave Waitlist
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
