import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, MapPin, Mail, CheckCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { ShiftInvitation } from "@/hooks/useShiftInvitations";

interface Props {
  invitations: ShiftInvitation[];
  /** id of an invitation whose accept/decline is mid-flight; disables both buttons on that row. */
  actioningId: string | null;
  onAccept: (inv: ShiftInvitation) => void;
  onDecline: (inv: ShiftInvitation) => void;
}

/**
 * "Shift Invitations" card. Shows per-row accept/decline; the parent owns the
 * conflict-modal flow that may open mid-accept.
 */
export function InvitationsList({ invitations, actioningId, onAccept, onDecline }: Props) {
  if (invitations.length === 0) return null;
  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" /> Shift Invitations
        </CardTitle>
        <CardDescription className="text-xs">
          An admin has invited you to the following shift{invitations.length !== 1 ? "s" : ""}. Respond before the shift starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invitations.map((inv) => {
          const s = inv.shifts;
          if (!s) return null;
          const isActioning = actioningId === inv.id;
          return (
            <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 px-3 rounded-md bg-primary/5 border border-primary/10">
              <div className="space-y-1 min-w-0">
                <p className="font-medium text-sm">{s.title}</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(s.shift_date + "T00:00:00"), "MMM d, yyyy")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}
                  </span>
                  {s.departments?.name && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {s.departments.name}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isActioning}
                  onClick={() => onDecline(inv)}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  disabled={isActioning}
                  onClick={() => onAccept(inv)}
                >
                  {isActioning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                  Accept
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
