import { Card, CardContent } from "@/components/ui/card";
import type { PendingConfirmation } from "@/hooks/useVolunteerBookings";

interface Props {
  pendingConfirmations: PendingConfirmation[];
}

/**
 * Banner shown above the upcoming-shifts list when the volunteer has
 * one or more shifts awaiting self-confirmation. Deeplinks to the first
 * one's confirmation page.
 */
export function PendingConfirmationsBanner({ pendingConfirmations }: Props) {
  if (pendingConfirmations.length === 0) return null;
  const count = pendingConfirmations.length;
  const firstBookingId = pendingConfirmations[0]?.booking_id;
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium">
            You have <span className="font-bold text-primary">{count}</span> shift{count !== 1 ? "s" : ""} awaiting your confirmation.
          </p>
          <a href={`/my-shifts/confirm/${firstBookingId}`} className="text-sm font-medium text-primary hover:underline">
            Confirm now →
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
