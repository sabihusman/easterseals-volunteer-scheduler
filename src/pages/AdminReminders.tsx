import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle } from "lucide-react";

export default function AdminReminders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("confirmation_reminders")
        .select("*, profiles(full_name), shift_bookings(id, confirmation_status, shifts(title, shift_date))")
        .order("sent_at", { ascending: false })
        .limit(50);
      setReminders(data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  const handleResolve = async (bookingId: string, status: "confirmed" | "no_show") => {
    const { error } = await supabase
      .from("shift_bookings")
      .update({ confirmation_status: status, confirmed_by: user!.id, confirmed_at: new Date().toISOString() })
      .eq("id", bookingId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setReminders((prev) => prev.map((r) => {
        if (r.shift_bookings?.id === bookingId) {
          return { ...r, shift_bookings: { ...r.shift_bookings, confirmation_status: status } };
        }
        return r;
      }));
      toast({ title: `Resolved as ${status.replace("_", " ")}` });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Confirmation Reminders</h2>
      <p className="text-muted-foreground">Track and resolve escalated confirmation reminders</p>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : reminders.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">No reminders sent yet.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {reminders.map((r) => {
            const isPending = r.shift_bookings?.confirmation_status === "pending_confirmation";
            return (
              <Card key={r.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium">{r.shift_bookings?.shifts?.title || "Shift"}</div>
                      <div className="text-sm text-muted-foreground">
                        Sent to: {r.profiles?.full_name} • {format(new Date(r.sent_at), "MMM d, yyyy h:mm a")}
                      </div>
                      {r.shift_bookings?.shifts?.shift_date && (
                        <div className="text-xs text-muted-foreground">Shift date: {format(new Date(r.shift_bookings.shifts.shift_date), "MMM d, yyyy")}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.recipient_type === "admin" ? "destructive" : "secondary"}>
                        {r.recipient_type}
                      </Badge>
                      <Badge variant="outline">#{r.reminder_number}</Badge>
                      {isPending && r.shift_bookings?.id && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => handleResolve(r.shift_bookings.id, "confirmed")}>
                            <CheckCircle className="h-3 w-3 mr-1" />Confirm
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleResolve(r.shift_bookings.id, "no_show")}>
                            <XCircle className="h-3 w-3 mr-1" />No Show
                          </Button>
                        </>
                      )}
                      {!isPending && (
                        <Badge variant="default" className="text-xs">
                          {r.shift_bookings?.confirmation_status?.replace("_", " ")}
                        </Badge>
                      )}
                    </div>
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
