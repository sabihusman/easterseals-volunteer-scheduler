import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin, Shield } from "lucide-react";
import { format } from "date-fns";
import { downloadICS, googleCalendarUrl, timeLabel } from "@/lib/calendar-utils";
import { getEffectiveTimes, isCheckInOpen } from "@/lib/shift-time";
import { BookedSlotsDisplay } from "@/components/BookedSlotsDisplay";
import { InviteFriendModal } from "@/components/InviteFriendModal";
import type { VolunteerBooking } from "@/hooks/useVolunteerBookings";

/**
 * Shape of a shift as needed by the parent's check-in / cancel handlers.
 * The full `shifts` object on a VolunteerBooking has more fields than this
 * type, but the union of what the two handlers read is captured here so
 * the component is self-contained.
 */
export type ShiftActionTarget = {
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  time_type: string | null;
  title: string;
  department_id: string;
};

interface Props {
  /** All bookings for this single shift (one if no time slots, multiple for slot bookings). */
  bookings: VolunteerBooking[];
  today: string;
  userId: string | undefined;
  onCheckIn: (bookingId: string, shift: ShiftActionTarget) => void;
  onCancel: (bookingId: string, shift: ShiftActionTarget) => void;
}

/**
 * One upcoming-shift card. Handles both single bookings and the
 * grouped per-slot case (where the volunteer booked multiple slots
 * within the same shift). The slot-by-slot cancel sub-list and the
 * "Cancel All Slots" confirm flow live here.
 */
export function UpcomingShiftCard({ bookings, today, userId, onCheckIn, onCancel }: Props) {
  const firstBooking = bookings[0];
  const s = firstBooking.shifts!;
  const isToday = s.shift_date === today;
  const { start: shiftStart } = getEffectiveTimes(s);
  const shiftStartMs = shiftStart.getTime();
  const nowMs = Date.now();
  const checkInOpen = isToday && isCheckInOpen(s, new Date(nowMs));
  const anyCheckedIn = bookings.some((b) => !!b.checked_in_at);

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1 flex-1">
            <div className="font-medium">{s.title}</div>
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.departments?.name}</span>
            </div>
            <div className="flex gap-2">
              {s.requires_bg_check && <Badge variant="outline" className="text-xs"><Shield className="h-3 w-3 mr-1" />BG Check</Badge>}
            </div>
            {/* Per-slot bookings */}
            <BookedSlotsDisplay shiftId={s.id} volunteerId={userId} />

            {/* Individual slot actions */}
            {bookings.length > 1 && (
              <div className="space-y-1 mt-2 pl-2 border-l-2 border-muted">
                {bookings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {b.time_slot_id ? "Slot booking" : "Full shift"}
                    </span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={() => onCancel(b.id, s)}>
                      Cancel Slot
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {checkInOpen && !anyCheckedIn && (
              <Button size="sm" onClick={() => onCheckIn(firstBooking.id, s)}>Check In</Button>
            )}
            {isToday && !anyCheckedIn && !checkInOpen && nowMs < shiftStartMs && (
              <Badge variant="outline" className="text-xs">Check-in opens 30 min before start</Badge>
            )}
            {anyCheckedIn && <Badge className="text-xs bg-success text-success-foreground">Checked In</Badge>}
            <div className="flex gap-1 flex-wrap">
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => downloadICS(s)} aria-label="Download iCal">
                📅 iCal
              </Button>
              <Button variant="ghost" size="sm" className="text-xs h-7" asChild>
                <a href={googleCalendarUrl(s)} target="_blank" rel="noopener noreferrer" aria-label="Add to Google Calendar">
                  📆 Google
                </a>
              </Button>
              {!s.requires_bg_check && (
                <InviteFriendModal shiftId={s.id} shiftTitle={s.title} shiftDate={s.shift_date} shiftTime={timeLabel(s)} />
              )}
            </div>
            {bookings.length === 1 ? (
              <Button variant="outline" size="sm" onClick={() => onCancel(firstBooking.id, s)}>Cancel</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => {
                const ok = window.confirm(`Cancel all ${bookings.length} slot bookings for ${s.title}?`);
                if (ok) bookings.forEach((b) => onCancel(b.id, s));
              }}>Cancel All Slots</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
