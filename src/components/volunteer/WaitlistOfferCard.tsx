import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import type { VolunteerBooking } from "@/hooks/useVolunteerBookings";

interface Props {
  offer: VolunteerBooking;
  onAccept: (bookingId: string) => void;
  onDecline: (bookingId: string) => void;
}

/**
 * One waitlist-offer card with the expiry countdown and accept/decline actions.
 * Caller maps over `waitlistOffers` and renders one of these per offer.
 */
export function WaitlistOfferCard({ offer, onAccept, onDecline }: Props) {
  const s = offer.shifts;
  const expiresAt = new Date(offer.waitlist_offer_expires_at!);
  const minutesLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 60000));
  return (
    <Card className="border-amber-500/50 bg-amber-500/10">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="font-semibold">Waitlist spot opened: {s?.title}</p>
            <p className="text-sm text-muted-foreground">
              {s && format(new Date(s.shift_date + "T00:00:00"), "MMMM d, yyyy")}
              {s?.departments?.name ? ` · ${s.departments.name}` : ""}
            </p>
            <p className="text-xs text-amber-700">
              You have {minutesLeft >= 60
                ? `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m`
                : `${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}`} to respond.
              The offer forfeits at {format(expiresAt, "h:mm a")}.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => onDecline(offer.id)}>
            Decline
          </Button>
          <Button size="sm" onClick={() => onAccept(offer.id)}>
            <CheckCircle className="h-4 w-4 mr-2" /> Accept Shift
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
