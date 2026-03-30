import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar, Clock, FileText, Upload, Download, Award, UserPlus } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { downloadCSV, timeLabel } from "@/lib/calendar-utils";
import { BookedSlotsDisplay } from "@/components/BookedSlotsDisplay";

export default function ShiftHistory() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [bookings, setBookings] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [activeBooking, setActiveBooking] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      const [{ data: bookingData }, { data: inviteData }] = await Promise.all([
        supabase
          .from("shift_bookings")
          .select("id, booking_status, confirmation_status, shifts(id, title, shift_date, time_type, start_time, end_time, departments(name))")
          .eq("volunteer_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("shift_invitations")
          .select("id, invite_name, invite_email, status, created_at, expires_at, shifts(title, shift_date)")
          .eq("invited_by", user.id)
          .order("created_at", { ascending: false }),
      ]);
      const bookingsArr = (bookingData as any) || [];
      // Fetch booked slots for all bookings to calculate hours
      const bookingIds = bookingsArr.map((b: any) => b.id);
      let slotMap: Record<string, number> = {};
      if (bookingIds.length > 0) {
        const { data: slotData } = await supabase
          .from("shift_booking_slots")
          .select("booking_id, shift_time_slots(slot_start, slot_end)")
          .in("booking_id", bookingIds);
        (slotData || []).forEach((s: any) => {
          if (!s.shift_time_slots) return;
          const [sh, sm] = s.shift_time_slots.slot_start.split(":").map(Number);
          const [eh, em] = s.shift_time_slots.slot_end.split(":").map(Number);
          const hours = (eh * 60 + em - sh * 60 - sm) / 60;
          slotMap[s.booking_id] = (slotMap[s.booking_id] || 0) + hours;
        });
      }
      // Attach slot hours to each booking
      bookingsArr.forEach((b: any) => { b._slotHours = slotMap[b.id] || 0; });
      setBookings(bookingsArr);
      setInvitations((inviteData as any) || []);
      setLoading(false);
    };
    fetchData();
  }, [user]);

  const pastBookings = bookings.filter(b => b.shifts && b.shifts.shift_date < new Date().toISOString().split("T")[0]);

  // Hours summary by month
  const hoursByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    pastBookings.filter(b => b.confirmation_status === "confirmed").forEach((b) => {
      const month = format(new Date(b.shifts.shift_date), "yyyy-MM");
      // Use slot-based hours if available, fall back to estimate
      const hours = b._slotHours > 0 ? b._slotHours : (b.shifts.time_type === "all_day" ? 8 : 4);
      map[month] = (map[month] || 0) + hours;
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [pastBookings]);

  const handleAddNote = async () => {
    if (!activeBooking || !noteContent.trim() || !user) return;
    if (noteContent.length > 2000) {
      toast({ title: "Note too long", description: "Notes must be under 2000 characters.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("shift_notes").insert({
      booking_id: activeBooking,
      author_id: user.id,
      content: noteContent.trim(),
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Note added" });
      setNoteContent("");
      setActiveBooking(null);
    }
  };

  const handleUpload = async (bookingId: string, files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${bookingId}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("shift-attachments").upload(path, file);
      if (uploadErr) {
        toast({ title: "Upload failed", description: uploadErr.message, variant: "destructive" });
        continue;
      }
      // Create a note for the attachment
      const { data: noteData } = await supabase.from("shift_notes").insert({
        booking_id: bookingId,
        author_id: user.id,
        content: `Attachment: ${file.name}`,
      }).select("id").single();
      if (noteData) {
        await supabase.from("shift_attachments").insert({
          note_id: noteData.id,
          uploader_id: user.id,
          file_name: file.name,
          file_type: file.type,
          storage_path: path,
          file_size: file.size,
        });
      }
    }
    setUploading(false);
    toast({ title: "File(s) uploaded" });
  };

  const handleExportCSV = () => {
    const data = pastBookings.map((b) => ({
      Date: b.shifts.shift_date,
      Shift: b.shifts.title,
      Department: b.shifts.departments?.name || "",
      Time: timeLabel(b.shifts),
      Status: b.confirmation_status,
      "Booking Status": b.booking_status,
    }));
    downloadCSV(data, `shift_history_${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "confirmed": return <Badge className="text-xs bg-success text-success-foreground">Confirmed</Badge>;
      case "no_show": return <Badge variant="destructive" className="text-xs">No Show</Badge>;
      case "cancelled": return <Badge variant="secondary" className="text-xs">Cancelled</Badge>;
      default: return <Badge variant="secondary" className="text-xs">{status.replace("_", " ")}</Badge>;
    }
  };

  const milestoneBadges = [10, 25, 50, 100];
  const hours = profile?.total_hours ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Shift History</h2>
          <p className="text-muted-foreground">View your past volunteer shifts and hours</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCSV}>
          <Download className="h-4 w-4 mr-1" />Export CSV
        </Button>
      </div>

      {/* Milestone badges */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Milestones:</span>
        {milestoneBadges.map((m) => (
          <Badge key={m} variant={hours >= m ? "default" : "secondary"} className="text-xs">
            {hours >= m && <Award className="h-3 w-3 mr-1" />}{m} hours
          </Badge>
        ))}
      </div>

      {/* Hours by month */}
      {hoursByMonth.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h4 className="font-medium text-sm mb-2">Hours by Month</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {hoursByMonth.slice(0, 8).map(([month, h]) => (
                <div key={month} className="text-center p-2 bg-muted rounded">
                  <div className="text-lg font-bold">{h}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(month + "-01"), "MMM yyyy")}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : pastBookings.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">No past shifts found.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {pastBookings.map((b) => {
            const s = b.shifts;
            return (
              <Card key={b.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium">{s.title}</div>
                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary" className="text-xs">{s.departments?.name}</Badge>
                        {statusBadge(b.confirmation_status)}
                      </div>
                      <BookedSlotsDisplay bookingId={b.id} />
                    </div>
                    <div className="flex gap-2">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => setActiveBooking(b.id)}>
                            <FileText className="h-3 w-3 mr-1" />Note
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Add Note for {s.title}</DialogTitle></DialogHeader>
                          <Textarea placeholder="Write your note..." value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={4} maxLength={2000} />
                          <p className="text-xs text-muted-foreground">{noteContent.length}/2000</p>
                          {noteContent.length > 2000 && <p className="text-xs text-destructive">Note must be under 2000 characters</p>}
                          <Button onClick={handleAddNote} disabled={!noteContent.trim() || noteContent.length > 2000}>Save Note</Button>
                        </DialogContent>
                      </Dialog>
                      <label className="cursor-pointer">
                        <Button variant="outline" size="sm" asChild>
                          <span><Upload className="h-3 w-3 mr-1" />{uploading ? "..." : "Upload"}</span>
                        </Button>
                        <Input
                          type="file"
                          className="hidden"
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          multiple
                          onChange={(e) => handleUpload(b.id, e.target.files)}
                        />
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sent Invitations */}
      {invitations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Sent Invitations
          </h3>
          <div className="grid gap-2">
            {invitations.map((inv) => (
              <Card key={inv.id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="font-medium text-sm">{inv.invite_name} ({inv.invite_email})</div>
                      <div className="text-xs text-muted-foreground">
                        {inv.shifts?.title} — {inv.shifts?.shift_date ? format(new Date(inv.shifts.shift_date), "MMM d, yyyy") : ""}
                      </div>
                    </div>
                    <Badge
                      variant={inv.status === "accepted" ? "default" : inv.status === "expired" ? "secondary" : "outline"}
                      className="text-xs w-fit"
                    >
                      {inv.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
