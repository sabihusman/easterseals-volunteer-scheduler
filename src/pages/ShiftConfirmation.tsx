import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Building2, Star, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { timeLabel } from "@/lib/calendar-utils";

export default function ShiftConfirmation() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [booking, setBooking] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [attended, setAttended] = useState<boolean | null>(null);
  const [hours, setHours] = useState("");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [privateNote, setPrivateNote] = useState("");

  useEffect(() => {
    if (!bookingId || !user) return;
    const load = async () => {
      const { data: b } = await supabase
        .from("shift_bookings")
        .select("*, shifts!shift_bookings_shift_id_fkey(*, departments(name))")
        .eq("id", bookingId)
        .eq("volunteer_id", user.id)
        .single();

      if (!b) {
        toast({ title: "Booking not found", variant: "destructive" });
        navigate("/dashboard");
        return;
      }
      setBooking(b);

      const { data: r } = await supabase
        .from("volunteer_shift_reports")
        .select("*")
        .eq("booking_id", bookingId)
        .single();
      setReport(r);
      setLoading(false);
    };
    load();
  }, [bookingId, user]);

  const maxHours = (() => {
    if (!booking?.shifts) return 8;
    const s = booking.shifts;
    let baseHours: number;
    if (s.time_type === "custom" && s.start_time && s.end_time) {
      const [sh, sm] = s.start_time.split(":").map(Number);
      const [eh, em] = s.end_time.split(":").map(Number);
      baseHours = Math.max(0.5, (eh * 60 + em - sh * 60 - sm) / 60);
    } else if (s.time_type === "morning" || s.time_type === "afternoon") {
      baseHours = 4;
    } else {
      baseHours = 8;
    }
    // If the volunteer checked in before shift start, the early window
    // counts toward their hours (up to the 30-minute check-in grace period).
    if (booking.checked_in_at && s.start_time && s.shift_date) {
      const checkedInMs = new Date(booking.checked_in_at).getTime();
      const shiftStartMs = new Date(`${s.shift_date}T${s.start_time}`).getTime();
      if (checkedInMs < shiftStartMs) {
        const earlyMinutes = Math.min(30, (shiftStartMs - checkedInMs) / 60000);
        baseHours += earlyMinutes / 60;
      }
    }
    // Round to nearest 0.25 for cleaner display
    return Math.round(baseHours * 4) / 4;
  })();

  const handleSubmit = async () => {
    if (!booking || !user) return;
    setSubmitting(true);

    if (attended === false) {
      // Self-reported no-show — upsert so it works whether or not a row exists
      const { error: reportErr } = await supabase
        .from("volunteer_shift_reports")
        .upsert({
          booking_id: bookingId!,
          self_confirm_status: "no_show" as any,
          submitted_at: new Date().toISOString(),
        }, { onConflict: "booking_id" });
      if (reportErr) {
        toast({ title: "Error", description: reportErr.message, variant: "destructive" });
        setSubmitting(false);
        return;
      }

      const { error: bookingErr } = await supabase
        .from("shift_bookings")
        .update({ confirmation_status: "no_show" as any })
        .eq("id", bookingId!);
      if (bookingErr) {
        toast({ title: "Error", description: bookingErr.message, variant: "destructive" });
        setSubmitting(false);
        return;
      }

      // Notify coordinators (using booking_changed type so the webhook routes it)
      const { data: coords } = await supabase
        .from("department_coordinators")
        .select("coordinator_id")
        .eq("department_id", booking.shifts.department_id);

      const profile = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      const volName = profile.data?.full_name || "A volunteer";

      for (const c of coords || []) {
        await supabase.from("notifications").insert({
          user_id: c.coordinator_id,
          type: "booking_changed",
          title: "Volunteer Self-Reported No-Show",
          message: `${volName} has self-reported as a no-show for ${booking.shifts.title} on ${format(new Date(booking.shifts.shift_date + "T00:00:00"), "MMM d, yyyy")}`,
        });
      }

      toast({ title: "Recorded as no-show" });
      navigate("/dashboard");
      setSubmitting(false);
      return;
    }

    // Attended
    const hoursNum = parseFloat(hours) || 0;
    if (hoursNum < 0.5 || hoursNum > maxHours) {
      toast({ title: "Invalid hours", description: `Enter between 0.5 and ${maxHours}`, variant: "destructive" });
      setSubmitting(false);
      return;
    }
    if (rating < 1 || rating > 5) {
      toast({ title: "Please rate this shift (1-5 stars)", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Save to volunteer_shift_reports — upsert so it works whether or not a row exists.
    // The DB trigger automatically syncs self_reported_hours to
    // shift_bookings.volunteer_reported_hours and runs resolve_hours_discrepancy().
    // volunteer_id is required by the RLS policy (volunteer_id = auth.uid()).
    // Without it the inserted row gets volunteer_id = NULL which fails
    // the WITH CHECK and returns "new row violates row-level security
    // policy for table volunteer_shift_reports".
    const { error: reportErr } = await supabase
      .from("volunteer_shift_reports")
      .upsert({
        booking_id: bookingId!,
        volunteer_id: user.id,
        self_confirm_status: "attended" as any,
        self_reported_hours: hoursNum,
        star_rating: rating,
        shift_feedback: feedback.trim() || null,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "booking_id" });
    if (reportErr) {
      toast({ title: "Error", description: reportErr.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Private note
    if (privateNote.trim()) {
      const { error: noteErr } = await supabase.from("volunteer_private_notes").insert({
        volunteer_id: user.id,
        shift_id: booking.shift_id,
        department_id: booking.shifts.department_id,
        content: privateNote.trim(),
      });
      if (noteErr) {
        toast({ title: "Saved confirmation, but note failed", description: noteErr.message, variant: "destructive" });
        setSubmitting(false);
        return;
      }
    }

    toast({ title: "Confirmation submitted!" });
    navigate("/dashboard");
    setSubmitting(false);
  };

  if (loading) return <div className="max-w-2xl mx-auto p-6 text-muted-foreground">Loading...</div>;

  if (report?.submitted_at) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            <CheckCircle className="h-12 w-12 text-success mx-auto" />
            <h3 className="text-lg font-semibold">Already Confirmed</h3>
            <p className="text-muted-foreground">You submitted your confirmation on {format(new Date(report.submitted_at), "MMM d, yyyy 'at' h:mm a")}.</p>
            <Button variant="outline" onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const shift = booking?.shifts;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Shift Confirmation</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{shift?.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{shift?.shift_date ? format(new Date(shift.shift_date + "T00:00:00"), "MMMM d, yyyy") : ""}</span>
            <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{shift ? timeLabel(shift) : ""}</span>
            <span className="flex items-center gap-1"><Building2 className="h-4 w-4" />{shift?.departments?.name}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-6">
          <div>
            <Label className="text-base font-medium">Did you attend this shift?</Label>
            <div className="flex gap-3 mt-3">
              <Button
                variant={attended === true ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAttended(true)}
              >
                <CheckCircle className="h-4 w-4 mr-2" />Yes, I attended
              </Button>
              <Button
                variant={attended === false ? "destructive" : "outline"}
                className="flex-1"
                onClick={() => setAttended(false)}
              >
                <XCircle className="h-4 w-4 mr-2" />No, I didn't attend
              </Button>
            </div>
          </div>

          {attended === true && (
            <>
              <div className="space-y-2">
                <Label>How many hours did you volunteer?</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max={maxHours}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder={`0.5 – ${maxHours}`}
                />
                <p className="text-xs text-muted-foreground">Max: {maxHours} hours for this shift</p>
              </div>

              <div className="space-y-2">
                <Label>Rate this shift</Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setRating(n)} className="p-1">
                      <Star
                        className={`h-7 w-7 transition-colors ${n <= rating ? "fill-warning text-warning" : "text-muted-foreground"}`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Shift feedback (optional)</Label>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value.slice(0, 1000))}
                  placeholder="How was the shift? Any suggestions?"
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground">{feedback.length}/1000</p>
              </div>

              <div className="space-y-2">
                <Label>Private note (optional)</Label>
                <Textarea
                  value={privateNote}
                  onChange={(e) => setPrivateNote(e.target.value.slice(0, 2000))}
                  placeholder="This note is private and only visible to you"
                  maxLength={2000}
                />
                <p className="text-xs text-muted-foreground">{privateNote.length}/2000 — Only you can see this</p>
              </div>
            </>
          )}

          {attended === false && (
            <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
              Marking yourself as a no-show will update your attendance record and notify your department coordinator.
            </div>
          )}

          {attended !== null && (
            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? "Submitting..." : "Submit Confirmation"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
