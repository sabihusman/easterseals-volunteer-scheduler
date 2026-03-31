import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const INACTIVE_WARNING_MS = 4 * 60 * 1000; // 4 minutes
const SIGNOUT_MS = 5 * 60 * 1000; // 5 minutes
const COUNTDOWN_TOTAL = 60; // seconds between warning and signout

const EXCLUDED_PATHS = ["/auth", "/reset-password"];

export function SessionTimeout() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_TOTAL);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const isExcluded = EXCLUDED_PATHS.some((p) => location.pathname.startsWith(p));

  const clearAllTimers = useCallback(() => {
    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (signoutTimer.current) clearTimeout(signoutTimer.current);
    if (countdownInterval.current) clearInterval(countdownInterval.current);
  }, []);

  const doSignOut = useCallback(async () => {
    clearAllTimers();
    setShowWarning(false);
    await supabase.auth.signOut();
    navigate("/auth", { state: { inactivitySignout: true } });
  }, [clearAllTimers, navigate]);

  const resetTimers = useCallback(() => {
    if (isExcluded || !user) return;
    clearAllTimers();
    setShowWarning(false);
    setCountdown(COUNTDOWN_TOTAL);

    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
      setCountdown(COUNTDOWN_TOTAL);
      countdownInterval.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
    }, INACTIVE_WARNING_MS);

    signoutTimer.current = setTimeout(() => {
      doSignOut();
    }, SIGNOUT_MS);
  }, [isExcluded, user, clearAllTimers, doSignOut]);

  // Attach activity listeners
  useEffect(() => {
    if (isExcluded || !user) return;

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    const handler = () => {
      if (!showWarning) resetTimers();
    };

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetTimers();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      clearAllTimers();
    };
  }, [isExcluded, user, resetTimers, clearAllTimers, showWarning]);

  // Handle countdown reaching 0
  useEffect(() => {
    if (countdown === 0 && showWarning) {
      doSignOut();
    }
  }, [countdown, showWarning, doSignOut]);

  const handleStayLoggedIn = () => {
    setShowWarning(false);
    resetTimers();
  };

  if (!user || isExcluded) return null;

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;

  return (
    <AlertDialog open={showWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Your session is about to expire</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              You have been inactive for 4 minutes. You will be automatically
              signed out in 1 minute to protect your account.
            </p>
            <p className="font-semibold text-foreground">
              Signing out in {mins}:{secs.toString().padStart(2, "0")}...
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={doSignOut}>
            Sign Out Now
          </Button>
          <Button onClick={handleStayLoggedIn}>Stay Logged In</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
