import { useState, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Leaf, Lock, User, Loader2, CheckCircle, Calendar, Clock, MapPin, AlertTriangle, LogIn } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";
import { format } from "date-fns";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

type Step = "validating" | "invalid" | "login" | "matching" | "confirm" | "checking_in" | "success" | "already" | "no_shift";

interface MatchedShift {
  bookingId: string;
  shiftId: string;
  title: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  departmentName: string;
  timeSlotId: string | null;
  slotStart: string | null;
  slotEnd: string | null;
}

export default function CheckIn() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("validating");
  const [user, setUser] = useState<any>(null);
  const [volunteerName, setVolunteerName] = useState("");
  const [matchedShifts, setMatchedShifts] = useState<MatchedShift[]>([]);
  const [selectedShift, setSelectedShift] = useState<MatchedShift | null>(null);

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // ── Step 1: Validate the QR token ──────────────────────────
  useEffect(() => {
    if (!token) {
      setStep("invalid");
      return;
    }
    (async () => {
      const { data: valid, error } = await supabase.rpc("validate_checkin_token", {
        p_token: token,
      });
      if (error || !valid) {
        setStep("invalid");
        return;
      }
      // Token is valid — check if user is already logged in
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        // Skip login, go to shift matching
        await matchShifts(session.user.id);
      } else {
        setStep("login");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Step 2: Handle login ───────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      toast({ title: "Verification required", description: "Please complete the security check.", variant: "destructive" });
      return;
    }
    setLoginLoading(true);

    // Resolve identifier
    let emailToUse = loginIdentifier.trim();
    if (!emailToUse.includes("@")) {
      const { data: resolvedEmail } = await supabase.rpc("get_email_by_username", {
        p_username: emailToUse,
      });
      if (!resolvedEmail) {
        setLoginLoading(false);
        setTurnstileToken(null);
        toast({ title: "Login failed", description: "Invalid credentials.", variant: "destructive" });
        return;
      }
      emailToUse = resolvedEmail as string;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: loginPassword,
      options: { captchaToken: turnstileToken },
    });
    setTurnstileToken(null);

    if (error) {
      setLoginLoading(false);
      toast({ title: "Login failed", description: "Invalid credentials.", variant: "destructive" });
      return;
    }

    // MFA check
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      setLoginLoading(false);
      toast({
        title: "MFA Required",
        description: "Please complete MFA verification on the main site first, then scan the QR code again.",
        variant: "destructive",
      });
      return;
    }

    setUser(data.session?.user);
    setLoginLoading(false);
    await matchShifts(data.session!.user.id);
  };

  // ── Step 3: Match volunteer to today's shift(s) ────────────
  const matchShifts = useCallback(async (userId: string) => {
    setStep("matching");

    // Get volunteer name
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();
    setVolunteerName(profile?.full_name || "Volunteer");

    const today = new Date().toISOString().split("T")[0];
    const now = new Date();
    // Format current time as HH:MM:SS for comparison
    const currentTime = now.toTimeString().slice(0, 8);

    // Find confirmed bookings for today that haven't been checked in
    const { data: bookings } = await supabase
      .from("shift_bookings")
      .select(`
        id,
        shift_id,
        checked_in,
        checked_in_at,
        time_slot_id,
        shifts!inner(
          id, title, shift_date, start_time, end_time,
          departments(name)
        )
      `)
      .eq("volunteer_id", userId)
      .eq("booking_status", "confirmed")
      .eq("shifts.shift_date", today);

    if (!bookings || bookings.length === 0) {
      setStep("no_shift");
      return;
    }

    // Check if ALL are already checked in
    const unchecked = bookings.filter((b: any) => !b.checked_in && !b.checked_in_at);
    if (unchecked.length === 0) {
      setStep("already");
      return;
    }

    // Build matched shifts with slot times if applicable
    const matched: MatchedShift[] = [];
    for (const b of unchecked as any[]) {
      const s = b.shifts;
      let slotStart: string | null = null;
      let slotEnd: string | null = null;

      if (b.time_slot_id) {
        const { data: slot } = await supabase
          .from("shift_time_slots")
          .select("slot_start, slot_end")
          .eq("id", b.time_slot_id)
          .single();
        if (slot) {
          slotStart = slot.slot_start;
          slotEnd = slot.slot_end;
        }
      }

      // Only include shifts that haven't ended yet (with 30-min grace)
      const effectiveEnd = slotEnd || s.end_time;
      if (effectiveEnd && effectiveEnd < currentTime) {
        // Shift already ended, skip — but allow 30 min grace
        const [h, m] = effectiveEnd.split(":").map(Number);
        const endMins = h * 60 + m + 30;
        const [ch, cm] = currentTime.split(":").map(Number);
        const currentMins = ch * 60 + cm;
        if (currentMins > endMins) continue;
      }

      matched.push({
        bookingId: b.id,
        shiftId: s.id,
        title: s.title,
        shiftDate: s.shift_date,
        startTime: (slotStart || s.start_time)?.slice(0, 5),
        endTime: (slotEnd || s.end_time)?.slice(0, 5),
        departmentName: s.departments?.name || "Unknown",
        timeSlotId: b.time_slot_id,
        slotStart,
        slotEnd,
      });
    }

    if (matched.length === 0) {
      setStep("no_shift");
      return;
    }

    setMatchedShifts(matched);

    // If exactly one shift, auto-select
    if (matched.length === 1) {
      setSelectedShift(matched[0]);
      setStep("confirm");
    } else {
      setStep("confirm");
    }
  }, []);

  // ── Step 4: Perform check-in ──────────────────────────────
  const handleCheckIn = async (shift: MatchedShift) => {
    setStep("checking_in");

    const { error } = await supabase
      .from("shift_bookings")
      .update({
        checked_in: true,
        checked_in_at: new Date().toISOString(),
      })
      .eq("id", shift.bookingId);

    if (error) {
      toast({ title: "Check-in failed", description: error.message, variant: "destructive" });
      setStep("confirm");
      return;
    }

    // Send notification to coordinator(s) of the shift's department
    const { data: shiftInfo } = await supabase
      .from("shifts")
      .select("department_id")
      .eq("id", shift.shiftId)
      .single();

    if (shiftInfo) {
      const { data: coords } = await supabase
        .from("department_coordinators")
        .select("coordinator_id")
        .eq("department_id", shiftInfo.department_id);

      if (coords && coords.length > 0) {
        const notifications = coords.map((c: any) => ({
          user_id: c.coordinator_id,
          type: "volunteer_checked_in",
          title: `${volunteerName} checked in`,
          message: `${volunteerName} has checked in for "${shift.title}" (${shift.startTime} - ${shift.endTime}).`,
          link: "/coordinator",
          data: {
            shift_id: shift.shiftId,
            booking_id: shift.bookingId,
            volunteer_name: volunteerName,
          },
        }));
        await supabase.from("notifications").insert(notifications);
      }
    }

    setSelectedShift(shift);
    setStep("success");
  };

  // ── Step 5: Check in all shifts at once ────────────────────
  const handleCheckInAll = async () => {
    setStep("checking_in");

    for (const shift of matchedShifts) {
      const { error } = await supabase
        .from("shift_bookings")
        .update({
          checked_in: true,
          checked_in_at: new Date().toISOString(),
        })
        .eq("id", shift.bookingId);

      if (error) {
        toast({ title: "Check-in failed", description: error.message, variant: "destructive" });
        setStep("confirm");
        return;
      }
    }

    // Notify coordinator for first shift (covers the department)
    if (matchedShifts.length > 0) {
      const first = matchedShifts[0];
      const { data: shiftInfo } = await supabase
        .from("shifts")
        .select("department_id")
        .eq("id", first.shiftId)
        .single();

      if (shiftInfo) {
        const { data: coords } = await supabase
          .from("department_coordinators")
          .select("coordinator_id")
          .eq("department_id", shiftInfo.department_id);

        if (coords && coords.length > 0) {
          const notifications = coords.map((c: any) => ({
            user_id: c.coordinator_id,
            type: "volunteer_checked_in",
            title: `${volunteerName} checked in`,
            message: `${volunteerName} has checked in for ${matchedShifts.length} slot(s) today.`,
            link: "/coordinator",
          }));
          await supabase.from("notifications").insert(notifications);
        }
      }
    }

    setStep("success");
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary">
            <Leaf className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Easterseals Iowa</h1>
          <p className="text-muted-foreground">Volunteer Check-In</p>
        </div>

        {/* Validating token */}
        {step === "validating" && (
          <Card>
            <CardContent className="pt-6 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Validating check-in code...</p>
            </CardContent>
          </Card>
        )}

        {/* Invalid token */}
        {step === "invalid" && (
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
        )}

        {/* Login form */}
        {step === "login" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <LogIn className="h-5 w-5" /> Sign In to Check In
              </CardTitle>
              <CardDescription>
                Enter your credentials to check in for your shift.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="checkin-identifier">Email or Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="checkin-identifier"
                      type="text"
                      autoComplete="username"
                      className="pl-10"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkin-password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="checkin-password"
                      type="password"
                      autoComplete="current-password"
                      className="pl-10"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="flex justify-center">
                  <Turnstile
                    siteKey={TURNSTILE_SITE_KEY}
                    onSuccess={(t) => setTurnstileToken(t)}
                    onExpire={() => setTurnstileToken(null)}
                    options={{ theme: "light", size: "normal" }}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loginLoading || !turnstileToken}>
                  {loginLoading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Signing in...</>
                  ) : !turnstileToken ? (
                    "Verifying..."
                  ) : (
                    "Sign In & Check In"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Matching shifts */}
        {step === "matching" && (
          <Card>
            <CardContent className="pt-6 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Finding your shift...</p>
            </CardContent>
          </Card>
        )}

        {/* No shift found */}
        {step === "no_shift" && (
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
        )}

        {/* Already checked in */}
        {step === "already" && (
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
        )}

        {/* Confirm check-in */}
        {step === "confirm" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle>Confirm Check-In</CardTitle>
              <CardDescription>
                Welcome, {volunteerName}! {matchedShifts.length === 1
                  ? "Please confirm your shift check-in."
                  : `You have ${matchedShifts.length} slots today. Select one or check in to all.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {matchedShifts.map((shift) => (
                <button
                  key={shift.bookingId}
                  onClick={() => handleCheckIn(shift)}
                  className="w-full text-left rounded-lg border p-4 hover:bg-muted transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{shift.title}</p>
                    <Badge variant="outline" className="text-xs">
                      <MapPin className="h-3 w-3 mr-1" />
                      {shift.departmentName}
                    </Badge>
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(shift.shiftDate + "T00:00:00"), "MMM d, yyyy")}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {shift.startTime} - {shift.endTime}
                    </span>
                  </div>
                  <div className="text-xs text-primary font-medium">Tap to check in</div>
                </button>
              ))}

              {matchedShifts.length > 1 && (
                <Button className="w-full" onClick={handleCheckInAll}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Check In to All {matchedShifts.length} Slots
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Checking in... */}
        {step === "checking_in" && (
          <Card>
            <CardContent className="pt-6 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Checking you in...</p>
            </CardContent>
          </Card>
        )}

        {/* Success */}
        {step === "success" && (
          <Card className="border-green-500">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-green-700">You're Checked In!</h3>
              <p className="text-muted-foreground">
                Thank you, {volunteerName}! Your check-in has been recorded.
              </p>
              {selectedShift && (
                <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
                  <p className="font-medium">{selectedShift.title}</p>
                  <p className="text-muted-foreground">
                    {selectedShift.startTime} - {selectedShift.endTime} | {selectedShift.departmentName}
                  </p>
                </div>
              )}
              {!selectedShift && matchedShifts.length > 1 && (
                <div className="rounded-md border bg-muted/50 p-3 text-sm">
                  <p className="font-medium">Checked in to {matchedShifts.length} slots</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Checked in at {format(new Date(), "h:mm a")}
              </p>
              <Button variant="outline" asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
