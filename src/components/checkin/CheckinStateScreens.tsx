import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, CheckCircle, Calendar } from "lucide-react";

/**
 * Group of small per-state cards for the CheckIn page. Each renders a
 * single Card with no internal state; the page's state machine decides
 * which one to mount.
 */

export function ValidatingState() {
  return (
    <Card>
      <CardContent className="pt-6 flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Validating check-in code...</p>
      </CardContent>
    </Card>
  );
}

export function InvalidTokenState() {
  return (
    <Card className="border-destructive">
      <CardContent className="pt-6 text-center space-y-3">
        <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
        <h3 className="font-semibold text-lg">Invalid Check-In Code</h3>
        <p className="text-sm text-muted-foreground">
          This QR code is expired or invalid. Please ask a staff member for a valid check-in code.
        </p>
        <Button variant="outline" asChild>
          <Link to="/auth">Go to Login</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function MatchingState() {
  return (
    <Card>
      <CardContent className="pt-6 flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Finding your shift...</p>
      </CardContent>
    </Card>
  );
}

interface NamedProps {
  volunteerName: string;
}

export function NoShiftState({ volunteerName }: NamedProps) {
  return (
    <Card>
      <CardContent className="pt-6 text-center space-y-3">
        <Calendar className="h-10 w-10 text-muted-foreground mx-auto" />
        <h3 className="font-semibold text-lg">No Shift Found</h3>
        <p className="text-sm text-muted-foreground">
          Hi {volunteerName}, you don't have any upcoming shifts scheduled for today. If you believe this is an error, please contact your coordinator.
        </p>
        <Button variant="outline" asChild>
          <Link to="/dashboard">Go to Dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function AlreadyCheckedInState({ volunteerName }: NamedProps) {
  return (
    <Card className="border-green-500">
      <CardContent className="pt-6 text-center space-y-3">
        <CheckCircle className="h-10 w-10 text-green-600 mx-auto" />
        <h3 className="font-semibold text-lg">Already Checked In</h3>
        <p className="text-sm text-muted-foreground">
          Hi {volunteerName}, you've already checked in for all your shifts today. Thank you for volunteering!
        </p>
        <Button variant="outline" asChild>
          <Link to="/dashboard">Go to Dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function CheckinProgressState() {
  return (
    <Card>
      <CardContent className="pt-6 flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Checking you in...</p>
      </CardContent>
    </Card>
  );
}
