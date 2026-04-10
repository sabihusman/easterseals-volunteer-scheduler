import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  CalendarDays,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  max_attendees: number | null;
  requires_bg_check: boolean;
}

interface Registration {
  id: string;
  event_id: string;
  volunteer_id: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function VolunteerEvents() {
  const { toast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [attendeeCounts, setAttendeeCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

  /* ---------- Fetch ---------- */

  const loadData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    // Upcoming events
    const today = new Date().toISOString().split("T")[0];
    const { data: eventsData } = await supabase
      .from("events")
      .select("*")
      .gte("event_date", today)
      .order("event_date");

    if (eventsData) setEvents(eventsData as EventRow[]);

    // My registrations
    const { data: regs } = await supabase
      .from("event_registrations")
      .select("id, event_id, volunteer_id")
      .eq("volunteer_id", user.id);

    if (regs) setRegistrations(regs as Registration[]);

    // Attendee counts per event
    if (eventsData && eventsData.length > 0) {
      const ids = eventsData.map((e) => e.id);
      const { data: counts } = await supabase
        .from("event_registrations")
        .select("event_id")
        .in("event_id", ids);

      if (counts) {
        const map: Record<string, number> = {};
        for (const row of counts) {
          map[row.event_id] = (map[row.event_id] ?? 0) + 1;
        }
        setAttendeeCounts(map);
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ---------- Register / Unregister ---------- */

  const isRegistered = (eventId: string) =>
    registrations.some((r) => r.event_id === eventId);

  async function handleRegister(eventId: string) {
    if (!userId) return;
    setBusyEventId(eventId);

    const { error } = await supabase
      .from("event_registrations")
      .insert({ event_id: eventId, volunteer_id: userId });

    if (error) {
      toast({ variant: "destructive", title: "Registration failed", description: error.message });
    } else {
      toast({ title: "Registered!" });
      await loadData();
    }
    setBusyEventId(null);
  }

  async function handleUnregister(eventId: string) {
    if (!userId) return;
    setBusyEventId(eventId);

    const { error } = await supabase
      .from("event_registrations")
      .delete()
      .eq("event_id", eventId)
      .eq("volunteer_id", userId);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Registration cancelled" });
      await loadData();
    }
    setBusyEventId(null);
  }

  /* ---------- Derived ---------- */

  const myEventIds = new Set(registrations.map((r) => r.event_id));
  const myEvents = events.filter((e) => myEventIds.has(e.id));

  /* ---------- Event Card ---------- */

  function EventCard({ ev, showAction = true }: { ev: EventRow; showAction?: boolean }) {
    const count = attendeeCounts[ev.id] ?? 0;
    const full = ev.max_attendees ? count >= ev.max_attendees : false;
    const registered = isRegistered(ev.id);
    const busy = busyEventId === ev.id;

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{ev.title}</CardTitle>
          {ev.description && (
            <CardDescription className="line-clamp-3">
              {ev.description}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5" />
            {new Date(ev.event_date + "T00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            {ev.start_time?.slice(0, 5)} – {ev.end_time?.slice(0, 5)}
          </div>
          {ev.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" />
              {ev.location}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5" />
            {count} / {ev.max_attendees ?? "∞"} attendees
          </div>

          <div className="flex gap-1 pt-1">
            {ev.requires_bg_check && (
              <Badge variant="outline" className="text-xs border-primary text-primary">
                BG Check
              </Badge>
            )}
            {full && !registered && (
              <Badge variant="secondary" className="text-xs">
                Full
              </Badge>
            )}
          </div>
        </CardContent>

        {showAction && (
          <CardFooter>
            {registered ? (
              <div className="flex w-full items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Registered
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUnregister(ev.id)}
                  disabled={busy}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Cancel"
                  )}
                </Button>
              </div>
            ) : (
              <Button
                className="w-full bg-primary hover:bg-primary/90"
                disabled={full || busy}
                onClick={() => handleRegister(ev.id)}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {full ? "Event Full" : "Register"}
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
    );
  }

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <h1 className="text-2xl font-bold text-foreground">Events</h1>

      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse Events</TabsTrigger>
          <TabsTrigger value="mine">
            My Registrations
            {myEvents.length > 0 && (
              <Badge className="ml-2 bg-primary text-white text-[10px] px-1.5 py-0">
                {myEvents.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Browse */}
        <TabsContent value="browse" className="pt-4">
          {events.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">
              No upcoming events right now. Check back soon!
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* My Registrations */}
        <TabsContent value="mine" className="pt-4">
          {myEvents.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">
              You haven't registered for any events yet.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myEvents.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
