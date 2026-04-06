import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const ACTIVITY_KEY = "es_last_activity";

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
  const logoutMs = logoutMinutes * 60 * 1000;
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
    localStorage.removeItem(ACTIVITY_KEY);
    await supabase.auth.signOut();
    navigate("/auth", { state: { inactivitySignout: true } });
  }, [clearAllTimers, navigate]);

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    clearAllTimers();
    setShowWarning(false);
    setCountdown(countdownSeconds);

    // Sync activity timestamp across tabs via localStorage
    localStorage.setItem(ACTIVITY_KEY, Date.now().toString());

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
    }, logoutMs);
  }, [enabled, clearAllTimers, countdownSeconds, warningMs, logoutMs, doSignOut]);

  // Activity listeners — DOM events only (not network)
  useEffect(() => {
    if (!enabled) return;

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    const handler = () => {
      resetTimer();
    };

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      clearAllTimers();
    };
  }, [enabled, resetTimer, clearAllTimers]);

  // Cross-tab sync: listen for activity in other tabs via localStorage
  useEffect(() => {
    if (!enabled) return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_KEY && e.newValue) {
        // Another tab had activity — reset our timer too
        resetTimer();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [enabled, resetTimer]);

  // Handle countdown reaching 0
  useEffect(() => {
    if (countdown === 0 && showWarning) {
      doSignOut();
    }
  }, [countdown, showWarning, doSignOut]);

  return { showWarning, countdown, resetTimer, signOut: doSignOut };
}
