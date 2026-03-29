import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Users, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function CoordinatorDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [shifts, setShifts] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data: coords } = await supabase
        .from("department_coordinators")
        .select("department_id, departments(id, name)")
        .eq("coordinator_id", user.id);
      const depts = (coords || []).map((c: any) => c.departments).filter(Boolean);
      setDepartments(depts);
      if (depts.length > 0) setSelectedDept(depts[0].id);
      setLoading(false);
    };
    fetch();
  }, [user]);

  useEffect(() => {
    if (!selectedDept) return;
    const fetch = async () => {
      const { data: shiftData } = await supabase
        .from("shifts")
        .select("*")
        .eq("department_id", selectedDept)
        .order("shift_date", { ascending: true });
      setShifts(shiftData || []);

      const shiftIds = (shiftData || []).map((s: any) => s.id);
      if (shiftIds.length > 0) {
        const { data: bookingData } = await supabase
          .from("shift_bookings")
          .select("*, profiles(full_name, email)")
          .in("shift_id", shiftIds)
          .eq("booking_status", "confirmed");
        setBookings(bookingData || []);
      } else {
        setBookings([]);
      }
    };
    fetch();
  }, [selectedDept]);

  const handleConfirm = async (bookingId: string, status: "confirmed" | "no_show") => {
    const { error } = await supabase
      .from("shift_bookings")
      .update({ confirmation_status: status, confirmed_by: user!.id, confirmed_at: new Date().toISOString() })
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, confirmation_status: status } : b));
      toast({ title: `Marked as ${status.replace("_", " ")}` });
    }
  };

  const deptName = departments.find(d => d.id === selectedDept)?.name || "";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Department Shifts</h2>
          <p className="text-muted-foreground">Manage shifts for your department</p>
        </div>
        {departments.length > 1 && (
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {departments.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">You're not assigned to any department.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {shifts.map((s) => {
            const shiftBookings = bookings.filter((b) => b.shift_id === s.id);
            return (
              <Card key={s.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{s.title}</CardTitle>
                    <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status}</Badge>
                  </div>
                  <div className="flex gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(s.shift_date), "MMM d, yyyy")}</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{s.booked_slots}/{s.total_slots}</span>
                  </div>
                </CardHeader>
                {shiftBookings.length > 0 && (
                  <CardContent>
                    <div className="space-y-2">
                      {shiftBookings.map((b) => (
                        <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50">
                          <div>
                            <div className="text-sm font-medium">{b.profiles?.full_name}</div>
                            <div className="text-xs text-muted-foreground">{b.profiles?.email}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {b.confirmation_status === "pending_confirmation" ? (
                              <>
                                <Button size="sm" variant="outline" onClick={() => handleConfirm(b.id, "confirmed")}>
                                  <CheckCircle className="h-3 w-3 mr-1" />Confirm
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleConfirm(b.id, "no_show")}>
                                  <XCircle className="h-3 w-3 mr-1" />No Show
                                </Button>
                              </>
                            ) : (
                              <Badge variant={b.confirmation_status === "confirmed" ? "default" : "destructive"} className="text-xs">
                                {b.confirmation_status.replace("_", " ")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
