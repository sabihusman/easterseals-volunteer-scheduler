import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import {
  Loader2,
  AlertTriangle,
  Send,
  Users,
  CalendarDays,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LowCoverageShift {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  max_volunteers: number;
  booked_count: number;
  department_name: string;
  requires_bg_check: boolean;
}

interface EligibleVolunteer {
  id: string;
  full_name: string;
  email: string;
  bg_check_cleared: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CoverageAlert() {
  const { toast } = useToast();

  const [shifts, setShifts] = useState<LowCoverageShift[]>([]);
  const [loading, setLoading] = useState(true);

  // Invitation modal
  const [inviteShift, setInviteShift] = useState<LowCoverageShift | null>(null);
  const [volunteers, setVolunteers] = useState<EligibleVolunteer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingVols, setLoadingVols] = useState(false);
  const [sending, setSending] = useState(false);

  /* ---------- Fetch low-coverage shifts ---------- */

  const fetchLowCoverage = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];

    // Fetch upcoming shifts with department info
    const { data: allShifts } = await supabase
      .from("shifts")
      .select("id, shift_date, start_time, end_time, max_volunteers, department_id, departments(name, requires_bg_check)")
      .gte("shift_date", today)
      .order("shift_date");

    if (!allShifts || allShifts.length === 0) {
      setLoading(false);
      return;
    }

    // Fetch booking counts per shift
    const shiftIds = allShifts.map((s) => s.id);
    const { data: bookings } = await supabase
      .from("shift_bookings")
      .select("shift_id")
      .in("shift_id", shiftIds)
      .eq("status", "confirmed");

    const countMap: Record<string, number> = {};
    if (bookings) {
      for (const b of bookings) {
        countMap[b.shift_id] = (countMap[b.shift_id] ?? 0) + 1;
      }
    }

    // Filter to < 50% filled
    const low: LowCoverageShift[] = [];
    for (const s of allShifts) {
      const booked = countMap[s.id] ?? 0;
      const pct = s.max_volunteers > 0 ? booked / s.max_volunteers : 1;
      if (pct < 0.5) {
        low.push({
          id: s.id,
          shift_date: s.shift_date,
          start_time: s.start_time,
          end_time: s.end_time,
          max_volunteers: s.max_volunteers,
          booked_count: booked,
          department_name: (s.departments as any)?.name ?? "Unknown",
          requires_bg_check: (s.departments as any)?.requires_bg_check ?? false,
        });
      }
    }

    setShifts(low);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLowCoverage();
  }, [fetchLowCoverage]);

  /* ---------- Open invite modal ---------- */

  async function openInviteModal(shift: LowCoverageShift) {
    setInviteShift(shift);
    setSelected(new Set());
    setLoadingVols(true);

    // Fetch already-booked volunteer IDs for this shift
    const { data: booked } = await supabase
      .from("shift_bookings")
      .select("volunteer_id")
      .eq("shift_id", shift.id)
      .in("status", ["confirmed", "waitlisted"]);

    const bookedIds = new Set((booked ?? []).map((b) => b.volunteer_id));

    // Fetch all active volunteers
    let query = supabase
      .from("profiles")
      .select("id, full_name, email, bg_check_cleared")
      .eq("role", "volunteer")
      .eq("is_active", true)
      .eq("is_restricted", false);

    if (shift.requires_bg_check) {
      query = query.eq("bg_check_cleared", true);
    }

    const { data: vols } = await query.order("full_name");

    const eligible = (vols ?? []).filter(
      (v) => !bookedIds.has(v.id)
    ) as EligibleVolunteer[];

    setVolunteers(eligible);
    setLoadingVols(false);
  }

  /* ---------- Toggle selection ---------- */

  function toggle(volId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(volId)) next.delete(volId);
      else next.add(volId);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === volunteers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(volunteers.map((v) => v.id)));
    }
  }

  /* ---------- Send invitations ---------- */

  async function sendInvitations() {
    if (!inviteShift || selected.size === 0) return;
    setSending(true);

    const notifications = [...selected].map((volId) => ({
      volunteer_id: volId,
      type: "shift_invitation",
      title: "You're invited to volunteer!",
      body: `A shift on ${inviteShift.shift_date} (${inviteShift.start_time?.slice(0, 5)}–${inviteShift.end_time?.slice(0, 5)}) in ${inviteShift.department_name} needs coverage.`,
      link: `/shifts?book=${inviteShift.id}`,
      read: false,
    }));

    const { error } = await supabase.from("notifications").insert(notifications);

    setSending(false);

    if (error) {
      toast({ variant: "destructive", title: "Send failed", description: error.message });
    } else {
      toast({
        title: "Invitations sent",
        description: `${selected.size} volunteer${selected.size > 1 ? "s" : ""} notified.`,
      });
      setInviteShift(null);
    }
  }

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[#006B3E]" />
      </div>
    );
  }

  if (shifts.length === 0) return null;

  return (
    <>
      <Card className="border-amber-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            Low Coverage Shifts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {shifts.map((s) => {
              const pct = Math.round(
                (s.booked_count / s.max_volunteers) * 100
              );
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-gray-900">
                      {s.department_name}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {s.shift_date}
                      </span>
                      <span>
                        {s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}
                      </span>
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-50 text-amber-700 text-[10px]"
                      >
                        {s.booked_count}/{s.max_volunteers} ({pct}%)
                      </Badge>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="w-full sm:w-auto bg-[#006B3E] hover:bg-[#005a33]"
                    onClick={() => openInviteModal(s)}
                  >
                    <Users className="mr-1.5 h-3.5 w-3.5" />
                    Invite Volunteers
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* ---- Invite Modal ---- */}
      <Dialog
        open={!!inviteShift}
        onOpenChange={(open) => { if (!open) setInviteShift(null); }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Invite Volunteers</DialogTitle>
            <DialogDescription>
              {inviteShift?.department_name} — {inviteShift?.shift_date}{" "}
              {inviteShift?.start_time?.slice(0, 5)}–
              {inviteShift?.end_time?.slice(0, 5)}
            </DialogDescription>
          </DialogHeader>

          {loadingVols ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#006B3E]" />
            </div>
          ) : volunteers.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No eligible volunteers found for this shift.
            </p>
          ) : (
            <div className="flex-1 overflow-y-auto -mx-6 px-6">
              {/* Select all */}
              <label className="flex items-center gap-2 border-b pb-2 mb-1 cursor-pointer">
                <Checkbox
                  checked={selected.size === volunteers.length}
                  onCheckedChange={selectAll}
                  className="data-[state=checked]:bg-[#006B3E] data-[state=checked]:border-[#006B3E]"
                />
                <span className="text-sm font-medium">
                  Select all ({volunteers.length})
                </span>
              </label>

              <ul className="divide-y">
                {volunteers.map((v) => (
                  <li key={v.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded">
                      <Checkbox
                        checked={selected.has(v.id)}
                        onCheckedChange={() => toggle(v.id)}
                        className="data-[state=checked]:bg-[#006B3E] data-[state=checked]:border-[#006B3E]"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {v.full_name}
                        </p>
                        <p className="text-xs text-gray-500">{v.email}</p>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter className="pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setInviteShift(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={selected.size === 0 || sending}
              onClick={sendInvitations}
              className="bg-[#006B3E] hover:bg-[#005a33]"
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send to {selected.size} volunteer{selected.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
