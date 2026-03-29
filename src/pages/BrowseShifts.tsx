import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Shield, Users } from "lucide-react";
import { format, addDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function BrowseShifts() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [shifts, setShifts] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [bookingIds, setBookingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetch = async () => {
      const [{ data: depts }, { data: shiftData }, { data: myBookings }] = await Promise.all([
        supabase.from("departments").select("id, name").eq("is_active", true),
        supabase
          .from("shifts")
          .select("*, departments(name)")
          .gte("shift_date", new Date().toISOString().split("T")[0])
          .in("status", ["open"])
          .order("shift_date", { ascending: true }),
        user
          ? supabase.from("shift_bookings").select("shift_id").eq("volunteer_id", user.id).in("booking_status", ["confirmed", "waitlisted"])
          : Promise.resolve({ data: [] }),
      ]);
      setDepartments(depts || []);
      setShifts(shiftData || []);
      setBookingIds(new Set((myBookings || []).map((b: any) => b.shift_id)));
      setLoading(false);
    };
    fetch();
  }, [user]);

  const handleBook = async (shiftId: string, isFull: boolean) => {
    if (!user) return;
    const { error } = await supabase.from("shift_bookings").insert({
      shift_id: shiftId,
      volunteer_id: user.id,
      booking_status: isFull ? "waitlisted" : "confirmed",
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setBookingIds((prev) => new Set(prev).add(shiftId));
      toast({ title: isFull ? "Added to waitlist" : "Shift booked!" });
    }
  };

  const filtered = selectedDept === "all" ? shifts : shifts.filter((s) => s.department_id === selectedDept);

  const timeLabel = (s: any) => {
    if (s.time_type === "custom" && s.start_time && s.end_time) return `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}`;
    return s.time_type.charAt(0).toUpperCase() + s.time_type.slice(1);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Available Shifts</h2>
          <p className="text-muted-foreground">Browse and book volunteer shifts</p>
        </div>
        <Select value={selectedDept} onValueChange={setSelectedDept}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading shifts...</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">No available shifts found.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s) => {
            const slotsLeft = s.total_slots - s.booked_slots;
            const isFull = slotsLeft <= 0;
            const alreadyBooked = bookingIds.has(s.id);
            return (
              <Card key={s.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium">{s.title}</div>
                      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeLabel(s)}</span>
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{isFull ? "Full" : `${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} left`}</span>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary" className="text-xs">{s.departments?.name}</Badge>
                        {s.requires_bg_check && <Badge variant="outline" className="text-xs"><Shield className="h-3 w-3 mr-1" />BG Check Required</Badge>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={alreadyBooked || !profile?.booking_privileges}
                      onClick={() => handleBook(s.id, isFull)}
                    >
                      {alreadyBooked ? "Booked" : isFull ? "Join Waitlist" : "Book Shift"}
                    </Button>
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
