import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar, Clock, FileText, Paperclip } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function ShiftHistory() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [activeBooking, setActiveBooking] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("shift_bookings")
        .select("id, booking_status, confirmation_status, shifts(id, title, shift_date, time_type, start_time, end_time, departments(name))")
        .eq("volunteer_id", user.id)
        .lt("shifts.shift_date", new Date().toISOString().split("T")[0])
        .order("created_at", { ascending: false });
      setBookings((data as any) || []);
      setLoading(false);
    };
    fetch();
  }, [user]);

  const handleAddNote = async () => {
    if (!activeBooking || !noteContent.trim() || !user) return;
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

  const statusBadge = (status: string) => {
    switch (status) {
      case "confirmed": return <Badge className="text-xs bg-success text-success-foreground">Confirmed</Badge>;
      case "no_show": return <Badge variant="destructive" className="text-xs">No Show</Badge>;
      case "cancelled": return <Badge variant="secondary" className="text-xs">Cancelled</Badge>;
      default: return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Shift History</h2>
        <p className="text-muted-foreground">View your past volunteer shifts</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : bookings.filter(b => b.shifts).length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">No past shifts found.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {bookings.filter(b => b.shifts).map((b) => {
            const s = b.shifts;
            return (
              <Card key={b.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium">{s.title}</div>
                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.time_type}</span>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary" className="text-xs">{s.departments?.name}</Badge>
                        {statusBadge(b.confirmation_status)}
                      </div>
                    </div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" onClick={() => setActiveBooking(b.id)}>
                          <FileText className="h-3 w-3 mr-1" />Add Note
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Add Note for {s.title}</DialogTitle></DialogHeader>
                        <Textarea placeholder="Write your note..." value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={4} />
                        <Button onClick={handleAddNote} disabled={!noteContent.trim()}>Save Note</Button>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
