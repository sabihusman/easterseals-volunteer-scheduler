import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  ShieldAlert,
  Search,
  FileText,
  Clock,
  Building2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";

interface NoteResult {
  id: string;
  title: string;
  content: string;
  shift_title: string | null;
  department_name: string | null;
  is_locked: boolean;
  created_at: string;
}

interface AuditEntry {
  id: string;
  admin_user_id: string;
  access_reason: string;
  accessed_at: string;
  admin_name?: string;
}

export default function AdminBreakGlass() {
  const { user } = useAuth();
  const [searchEmail, setSearchEmail] = useState("");
  const [volunteerId, setVolunteerId] = useState<string | null>(null);
  const [volunteerName, setVolunteerName] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<NoteResult[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accessed, setAccessed] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!searchEmail.trim()) return;
    setSearching(true);
    setError("");
    setVolunteerId(null);
    setVolunteerName("");
    setNotes([]);
    setAuditLog([]);
    setAccessed(false);

    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .or(`email.ilike.%${searchEmail.trim()}%,full_name.ilike.%${searchEmail.trim()}%`)
      .eq("role", "volunteer")
      .limit(1)
      .single();

    setSearching(false);

    if (!data) {
      setError("No volunteer found matching that name or email.");
      return;
    }

    setVolunteerId(data.id);
    setVolunteerName(`${data.full_name} (${data.email})`);

    // Load prior audit log for this volunteer
    const { data: log } = await supabase
      .from("private_note_access_log")
      .select("id, admin_user_id, access_reason, accessed_at")
      .eq("volunteer_id", data.id)
      .order("accessed_at", { ascending: false });

    if (log && log.length > 0) {
      // Fetch admin names
      const adminIds = [...new Set(log.map((l: AuditEntry) => l.admin_user_id))];
      const { data: admins } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", adminIds);
      const nameMap: Record<string, string> = {};
      (admins || []).forEach((a: { id: string; full_name: string }) => {
        nameMap[a.id] = a.full_name;
      });
      setAuditLog(
        (log as AuditEntry[]).map((l) => ({
          ...l,
          admin_name: nameMap[l.admin_user_id] || "Unknown",
        }))
      );
    }
  };

  const handleAccess = async () => {
    if (!volunteerId || reason.trim().length < 20) return;
    setConfirmOpen(false);
    setLoading(true);
    setError("");

    const { data, error: rpcError } = await (supabase as any).rpc(
      "admin_break_glass_read_notes",
      { target_volunteer_id: volunteerId, reason: reason.trim() }
    );

    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    if (data?.success) {
      setNotes(data.notes || []);
      setAccessed(true);
      // Refresh audit log
      handleSearch();
    } else {
      setError(data?.error || "Unknown error");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Warning banner */}
      <Alert className="border-destructive bg-destructive/10">
        <ShieldAlert className="h-5 w-5 text-destructive" />
        <AlertTitle className="text-destructive text-lg">
          Break-Glass Access — Private Notes
        </AlertTitle>
        <AlertDescription className="text-foreground space-y-2 mt-2">
          <p>
            This page provides emergency access to volunteer private notes for{" "}
            <strong>legal discovery and safety investigations only</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            All access is <strong>permanently logged</strong> in an append-only
            audit table that cannot be modified or deleted. The volunteer will be{" "}
            <strong>automatically notified</strong> that their notes were accessed,
            including your identity and the reason you provide. Easterseals
            leadership has approved this mechanism.
          </p>
        </AlertDescription>
      </Alert>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 1 — Find Volunteer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Volunteer name or email..."
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={searching || !searchEmail.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {volunteerName && (
            <p className="text-sm">
              Found: <strong>{volunteerName}</strong>
            </p>
          )}
          {error && !accessed && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Reason + access */}
      {volunteerId && !accessed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 2 — Provide Reason</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reason">
                Reason for access{" "}
                <span className="text-muted-foreground text-xs">(min 20 characters)</span>
              </Label>
              <Textarea
                id="reason"
                placeholder="Describe the legal or safety reason for accessing this volunteer's private notes. Be specific — this will be shown to the volunteer and stored permanently..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground text-right">
                {reason.trim().length}/20 characters
                {reason.trim().length >= 20 && " ✓"}
              </p>
            </div>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!volunteerId || reason.trim().length < 20 || loading}
              variant="destructive"
              className="w-full"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Accessing...</>
              ) : (
                <><ShieldAlert className="h-4 w-4 mr-2" />Access Private Notes</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirm Break-Glass Access
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-foreground">
              <p>
                You are about to access <strong>{volunteerName}</strong>'s
                private notes. This action:
              </p>
              <ul className="list-disc pl-5 text-sm space-y-1">
                <li>Is <strong>permanently logged</strong> and cannot be undone</li>
                <li>Will <strong>notify the volunteer</strong> with your name and reason</li>
                <li>Will record <strong>every note</strong> you access in the audit trail</li>
              </ul>
              <div className="mt-3 p-3 rounded-md bg-muted text-sm">
                <strong>Your stated reason:</strong>
                <p className="mt-1 text-muted-foreground">{reason}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAccess}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Proceed — Access Notes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notes display */}
      {accessed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Private Notes — {volunteerName}
              <Badge variant="destructive" className="text-xs ml-auto">
                Break-glass access
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                This volunteer has no private notes.
              </p>
            ) : (
              notes.map((note) => (
                <div
                  key={note.id}
                  className="rounded-md border p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm">
                      {note.title || "Untitled Note"}
                    </div>
                    {note.is_locked && (
                      <Badge variant="secondary" className="text-[10px]">
                        Locked
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {note.shift_title && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {note.shift_title}
                      </span>
                    )}
                    {note.department_name && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {note.department_name}
                      </span>
                    )}
                    <span>
                      {format(new Date(note.created_at), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* Audit log */}
      {volunteerId && auditLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Audit Log — Prior Break-Glass Accesses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {auditLog.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-md border p-3 text-sm space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{entry.admin_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(entry.accessed_at), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{entry.access_reason}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
