import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const EXCLUDED_PATHS = ["/auth", "/reset-password", "/forgot-password", "/mfa-verify"];

export function SessionTimeout() {
  const { user, role } = useAuth();
  const location = useLocation();
  const isExcluded = EXCLUDED_PATHS.some((p) => location.pathname.startsWith(p));

  const isVolunteer = role === "volunteer";
  const warningMinutes = isVolunteer ? 4 : 29;
  const logoutMinutes = isVolunteer ? 5 : 30;

  const { showWarning, countdown, resetTimer, signOut } = useInactivityTimeout({
    warningMinutes,
    logoutMinutes,
    enabled: !!user && !isExcluded,
  });

  if (!user || isExcluded) return null;

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;

  return (
    <AlertDialog open={showWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              You will be automatically signed out in{" "}
              <span className="font-semibold text-foreground">
                {mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}`}
              </span>{" "}
              seconds due to inactivity.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={signOut}>
            Sign Out Now
          </Button>
          <Button onClick={resetTimer}>Stay Signed In</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
