import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface UseInactivityTimeoutOptions {
  warningMinutes: number;
  logoutMinutes: number;
  enabled: boolean;
}

export function useInactivityTimeout({ warningMinutes, logoutMinutes, enabled }: UseInactivityTimeoutOptions) {
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const warningMs = warningMinutes * 60 * 1000;
  const countdownSeconds = (logoutMinutes - warningMinutes) * 60;

  const clearAllTimers = useCallback(() => {
    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    if (countdownInterval.current) clearInterval(countdownInterval.current);
    warningTimer.current = null;
    logoutTimer.current = null;
    countdownInterval.current = null;
  }, []);

  const doSignOut = useCallback(async () => {
    clearAllTimers();
    setShowWarning(false);
    await supabase.auth.signOut();
    navigate("/auth", { state: { inactivitySignout: true } });
  }, [clearAllTimers, navigate]);

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    clearAllTimers();
    setShowWarning(false);
    setCountdown(countdownSeconds);

    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
      setCountdown(countdownSeconds);
      countdownInterval.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) return 0;
          return prev - 1;
        });
      }, 1000);
    }, warningMs);

    logoutTimer.current = setTimeout(() => {
      doSignOut();
    }, logoutMinutes * 60 * 1000);
  }, [enabled, clearAllTimers, countdownSeconds, warningMs, logoutMinutes, doSignOut]);

  // Activity listeners
  useEffect(() => {
    if (!enabled) return;

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    const handler = () => {
      // Any activity resets timer, even during warning
      resetTimer();
    };

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      clearAllTimers();
    };
  }, [enabled, resetTimer, clearAllTimers]);

  // Handle countdown reaching 0
  useEffect(() => {
    if (countdown === 0 && showWarning) {
      doSignOut();
    }
  }, [countdown, showWarning, doSignOut]);

  return { showWarning, countdown, resetTimer, signOut: doSignOut };
}
