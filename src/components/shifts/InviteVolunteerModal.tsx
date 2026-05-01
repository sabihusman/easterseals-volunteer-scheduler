import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, UserPlus, AlertTriangle, CheckCircle } from "lucide-react";

interface Shift {
  id: string;
  title: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  department_id: string;
  total_slots: number;
  departments?: { name: string; requires_bg_check?: boolean };
}

interface VolunteerResult {
  id: string;
  full_name: string;
  email: string;
  bg_check_status: string;
  is_active: boolean;
}

interface ConflictInfo {
  shiftTitle: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
}

interface Props {
  shift: Shift;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}

export function InviteVolunteerModal({ shift, open, onOpenChange, onSent }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<VolunteerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<VolunteerResult | null>(null);
  const [sending, setSending] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [conflictConfirmOpen, setConflictConfirmOpen] = useState(false);
  const [alreadyInvited, setAlreadyInvited] = useState<Set<string>>(new Set());
  const [restricted, setRestricted] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Load already-invited volunteers and department restrictions
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [{ data: existing }, { data: restrictions }] = await Promise.all([
        supabase
          .from("shift_invitations")
          .select("volunteer_id")
          .eq("shift_id", shift.id)
          .eq("status", "pending")
          .not("volunteer_id", "is", null),
        supabase
          .from("department_restrictions")
          .select("volunteer_id")
          .eq("department_id", shift.department_id),
      ]);
      setAlreadyInvited(new Set((existing || []).map((r: any) => r.volunteer_id)));
      setRestricted(new Set((restrictions || []).map((r: any) => r.volunteer_id)));
    })();
  }, [open, shift.id, shift.department_id]);

  // Dynamic search
  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, bg_check_status, is_active")
        .eq("role", "volunteer")
        .eq("is_active", true)
        .ilike("full_name", `%${search.trim()}%`)
        .order("full_name")
        .limit(20);
      setResults(data || []);
      setSearching(false);
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setResults([]);
      setSelected(null);
      setConflict(null);
    }
  }, [open]);

  const deptRequiresBg = shift.departments?.requires_bg_check ?? false;

  function isEligible(v: VolunteerResult): { ok: boolean; reason?: string } {
    if (alreadyInvited.has(v.id)) return { ok: false, reason: "Already invited" };
    if (restricted.has(v.id)) return { ok: false, reason: "Restricted from department" };
    if (deptRequiresBg && v.bg_check_status !== "cleared")
      return { ok: false, reason: `BG check: ${v.bg_check_status}` };
    return { ok: true };
  }

  async function checkConflict(volunteerId: string): Promise<ConflictInfo | null> {
    // Find confirmed (or pending-approval) bookings on the same date
    // with overlapping times. Half B-1: a minor's pending booking
    // is a held slot — the trigger has rewritten the status — so we
    // treat it as a real conflict for invitation purposes too.
    const { data } = await supabase
      .from("shift_bookings")
      .select("shifts(title, shift_date, start_time, end_time)")
      .eq("volunteer_id", volunteerId)
      .in("booking_status", ["confirmed", "pending_admin_approval"] as never[]);

    if (!data) return null;

    for (const b of data as any[]) {
      const s = b.shifts;
      if (!s || s.shift_date !== shift.shift_date) continue;
      // Strict inequality overlap check (same as prevent_overlapping_bookings)
      const existStart = s.start_time;
      const existEnd = s.end_time;
      if (existStart < shift.end_time && existEnd > shift.start_time) {
        return {
          shiftTitle: s.title,
          shiftDate: s.shift_date,
          startTime: existStart?.slice(0, 5),
          endTime: existEnd?.slice(0, 5),
        };
      }
    }
    return null;
  }

  async function handleSelectVolunteer(v: VolunteerResult) {
    setSelected(v);
    // Check for conflicts
    const c = await checkConflict(v.id);
    setConflict(c);
    if (c) {
      setConflictConfirmOpen(true);
    } else {
      setConfirmOpen(true);
    }
  }

  async function sendInvitation() {
    if (!selected || !user) return;
    setSending(true);

    // Compute expires_at = shift start datetime
    const expiresAt = new Date(`${shift.shift_date}T${shift.start_time}`).toISOString();

    const { error } = await supabase.from("shift_invitations").insert({
      shift_id: shift.id,
      volunteer_id: selected.id,
      invited_by: user.id,
      invite_email: selected.email,
      status: "pending",
      expires_at: expiresAt,
      token: crypto.randomUUID(),
    });

    if (error) {
      setSending(false);
      toast({
        title: "Failed to send invitation",
        description: error.message.includes("uq_shift_invitation_volunteer")
          ? "This volunteer already has a pending invitation for this shift."
          : error.message,
        variant: "destructive",
      });
      setConfirmOpen(false);
      setConflictConfirmOpen(false);
      return;
    }

    // Send notification to the volunteer
    await supabase.from("notifications").insert({
      user_id: selected.id,
      type: "shift_invitation",
      title: `You've been invited to: ${shift.title}`,
      message: `An admin has invited you to volunteer for "${shift.title}" on ${shift.shift_date} from ${shift.start_time?.slice(0, 5)} to ${shift.end_time?.slice(0, 5)}. Open your dashboard to respond.`,
      link: "/dashboard",
      data: {
        shift_id: shift.id,
        shift_title: shift.title,
        shift_date: shift.shift_date,
      },
    });

    setSending(false);
    setConfirmOpen(false);
    setConflictConfirmOpen(false);
    onOpenChange(false);

    toast({
      title: "Invitation sent",
      description: `${selected.full_name} has been invited to ${shift.title}.`,
    });
    onSent?.();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" /> Invite Volunteer
            </DialogTitle>
            <DialogDescription>
              Search for a volunteer to invite to <strong>{shift.title}</strong> on {shift.shift_date}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="Search by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              {searching && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!searching && search.trim().length >= 2 && results.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No volunteers found.</p>
              )}
              {!searching && results.map((v) => {
                const elig = isEligible(v);
                return (
                  <button
                    key={v.id}
                    disabled={!elig.ok}
                    onClick={() => handleSelectVolunteer(v)}
                    className="w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{v.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{v.email}</p>
                    </div>
                    {!elig.ok && (
                      <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
                        {elig.reason}
                      </Badge>
                    )}
                    {elig.ok && (
                      <Badge className="text-xs shrink-0 bg-primary/10 text-primary border-primary/20">
                        Eligible
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Standard confirmation (no conflict) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Invite <strong>{selected?.full_name}</strong> to <strong>{shift.title}</strong> on {shift.shift_date}?
              They will receive a notification and can accept or decline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={sendInvitation} disabled={sending}>
              {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <>
                <CheckCircle className="h-4 w-4 mr-2" />Send Invitation</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conflict warning confirmation */}
      <AlertDialog open={conflictConfirmOpen} onOpenChange={setConflictConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Scheduling Conflict
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  <strong>{selected?.full_name}</strong> has a conflicting booking:
                </p>
                {conflict && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                    <strong>{conflict.shiftTitle}</strong> on {conflict.shiftDate} from {conflict.startTime} to {conflict.endTime}
                  </div>
                )}
                <p>Do you still want to send the invitation? The volunteer will be asked to resolve the conflict if they accept.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={sendInvitation} disabled={sending}>
              {sending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : "Send Anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
