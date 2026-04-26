import { Card, CardContent } from "@/components/ui/card";
import type { VolunteerBooking } from "@/hooks/useVolunteerBookings";
import { UpcomingShiftCard, type ShiftActionTarget } from "./UpcomingShiftCard";

interface Props {
  loading: boolean;
  privilegesSuspended: boolean;
  eligibleBookings: VolunteerBooking[];
  today: string;
  userId: string | undefined;
  onCheckIn: (bookingId: string, shift: ShiftActionTarget) => void;
  onCancel: (bookingId: string, shift: ShiftActionTarget) => void;
}

/**
 * "Upcoming Shifts" section: header + loading/empty/grouped-list states.
 * Groups bookings by shift_id (one card per shift; multiple bookings per
 * card when the volunteer booked individual slots).
 */
export function UpcomingShiftsSection({
  loading,
  privilegesSuspended,
  eligibleBookings,
  today,
  userId,
  onCheckIn,
  onCancel,
}: Props) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">Upcoming Shifts</h3>
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : eligibleBookings.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <p>{privilegesSuspended ? "Your booking privileges are suspended." : "No upcoming shifts."} <a href="/shifts" className="text-primary underline">Browse available shifts</a></p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {groupByShift(eligibleBookings).map((bookings) => (
            <UpcomingShiftCard
              key={bookings[0].shifts!.id}
              bookings={bookings}
              today={today}
              userId={userId}
              onCheckIn={onCheckIn}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function groupByShift(bookings: VolunteerBooking[]): VolunteerBooking[][] {
  const groupedMap = new Map<string, VolunteerBooking[]>();
  for (const b of bookings) {
    const sid = b.shifts?.id;
    if (!sid) continue;
    if (!groupedMap.has(sid)) groupedMap.set(sid, []);
    groupedMap.get(sid)!.push(b);
  }
  return Array.from(groupedMap.values());
}
