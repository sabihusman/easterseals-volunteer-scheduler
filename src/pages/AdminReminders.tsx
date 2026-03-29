import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function AdminReminders() {
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("confirmation_reminders")
        .select("*, profiles(full_name), shift_bookings(shifts(title, shift_date))")
        .order("sent_at", { ascending: false })
        .limit(50);
      setReminders(data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Confirmation Reminders</h2>
      <p className="text-muted-foreground">Track escalation reminders for unconfirmed shifts</p>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : reminders.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">No reminders sent yet.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {reminders.map((r) => (
            <Card key={r.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="font-medium">{r.shift_bookings?.shifts?.title || "Shift"}</div>
                    <div className="text-sm text-muted-foreground">
                      Sent to: {r.profiles?.full_name} • {format(new Date(r.sent_at), "MMM d, yyyy h:mm a")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={r.recipient_type === "admin" ? "destructive" : "secondary"}>
                      {r.recipient_type}
                    </Badge>
                    <Badge variant="outline">#{r.reminder_number}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
