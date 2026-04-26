import { useEffect, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  validateCheckinToken,
  fetchTodaysMatchedShifts,
  recordCheckin,
  notifyCoordinatorsOfCheckin,
  type MatchedShift,
} from "@/lib/checkin-actions";
import { CheckinHeader } from "@/components/checkin/CheckinHeader";
import {
  ValidatingState,
  InvalidTokenState,
  MatchingState,
  NoShiftState,
  AlreadyCheckedInState,
  CheckinProgressState,
} from "@/components/checkin/CheckinStateScreens";
import { LoginForm } from "@/components/checkin/LoginForm";
import { ConfirmCheckinScreen } from "@/components/checkin/ConfirmCheckinScreen";
import { SuccessScreen } from "@/components/checkin/SuccessScreen";

type Step =
  | "validating"
  | "invalid"
  | "login"
  | "matching"
  | "confirm"
  | "checking_in"
  | "success"
  | "already"
  | "no_shift";

/**
 * Volunteer check-in flow driven by a state machine on `step`. The page is
 * the orchestrator: each transition is an explicit page-level call into
 * `checkin-actions.ts`, which preserves the sensitive-ops sequence
 * (token validate → session check → login if needed → fetch today's
 * shifts with grace filter → record → notify coordinators).
 */
export default function CheckIn() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("validating");
  const [, setUser] = useState<User | null>(null);
  const [volunteerName, setVolunteerName] = useState("");
  const [matchedShifts, setMatchedShifts] = useState<MatchedShift[]>([]);
  const [selectedShift, setSelectedShift] = useState<MatchedShift | null>(null);

  // Step 3: shift matching. Defined before the validation effect so the
  // effect can call into it once the session is known.
  const matchShifts = useCallback(async (userId: string) => {
    setStep("matching");
    const currentTime = new Date().toTimeString().slice(0, 8);
    const result = await fetchTodaysMatchedShifts(userId, currentTime);
    setVolunteerName(result.volunteerName);
    if (result.kind === "no_shift") {
      setStep("no_shift");
      return;
    }
    if (result.kind === "already") {
      setStep("already");
      return;
    }
    setMatchedShifts(result.shifts);
    if (result.shifts.length === 1) {
      setSelectedShift(result.shifts[0]);
    }
    setStep("confirm");
  }, []);

  // Step 1: validate the QR token, then check session and either skip to
  // shift matching or send the user through login.
  useEffect(() => {
    if (!token) {
      setStep("invalid");
      return;
    }
    (async () => {
      const valid = await validateCheckinToken(token);
      if (!valid) {
        setStep("invalid");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        await matchShifts(session.user.id);
      } else {
        setStep("login");
      }
    })();
  }, [token, matchShifts]);

  // Step 2: login success handler — LoginForm owns its own form state and
  // performs the actual sign-in / MFA gate; we just take the resolved user
  // and continue the flow.
  const handleLoginSuccess = async (signedInUser: User) => {
    setUser(signedInUser);
    await matchShifts(signedInUser.id);
  };

  // Step 4: single-shift check-in. Validation order: record first, then
  // notify coordinators. If record fails, surface the error and stay on
  // confirm; coordinator notification is best-effort.
  const handleCheckIn = async (shift: MatchedShift) => {
    setStep("checking_in");
    const result = await recordCheckin(shift.bookingId);
    if (!result.ok) {
      toast({ title: "Check-in failed", description: result.error, variant: "destructive" });
      setStep("confirm");
      return;
    }
    await notifyCoordinatorsOfCheckin({
      shiftId: shift.shiftId,
      title: `${volunteerName} checked in`,
      message: `${volunteerName} has checked in for "${shift.title}" (${shift.startTime} - ${shift.endTime}).`,
      data: {
        shift_id: shift.shiftId,
        booking_id: shift.bookingId,
        volunteer_name: volunteerName,
      },
    });
    setSelectedShift(shift);
    setStep("success");
  };

  // Step 5: multi-slot check-in. Records all matched shifts, then sends a
  // single notification to coordinators of the first shift's department.
  const handleCheckInAll = async () => {
    setStep("checking_in");
    for (const shift of matchedShifts) {
      const result = await recordCheckin(shift.bookingId);
      if (!result.ok) {
        toast({ title: "Check-in failed", description: result.error, variant: "destructive" });
        setStep("confirm");
        return;
      }
    }
    if (matchedShifts.length > 0) {
      const first = matchedShifts[0];
      await notifyCoordinatorsOfCheckin({
        shiftId: first.shiftId,
        title: `${volunteerName} checked in`,
        message: `${volunteerName} has checked in for ${matchedShifts.length} slot(s) today.`,
      });
    }
    setStep("success");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <CheckinHeader />

        {step === "validating" && <ValidatingState />}
        {step === "invalid" && <InvalidTokenState />}
        {step === "login" && <LoginForm onLoginSuccess={handleLoginSuccess} />}
        {step === "matching" && <MatchingState />}
        {step === "no_shift" && <NoShiftState volunteerName={volunteerName} />}
        {step === "already" && <AlreadyCheckedInState volunteerName={volunteerName} />}
        {step === "confirm" && (
          <ConfirmCheckinScreen
            volunteerName={volunteerName}
            shifts={matchedShifts}
            onCheckIn={handleCheckIn}
            onCheckInAll={handleCheckInAll}
          />
        )}
        {step === "checking_in" && <CheckinProgressState />}
        {step === "success" && (
          <SuccessScreen
            volunteerName={volunteerName}
            shift={selectedShift}
            multiSlotCount={matchedShifts.length}
          />
        )}
      </div>
    </div>
  );
}
