import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  CalendarDays,
  MapPin,
  Users,
  Clock,
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
  created_at: string;
}

interface EventForm {
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  max_attendees: string;
  requires_bg_check: boolean;
}

const EMPTY_FORM: EventForm = {
  title: "",
  description: "",
  event_date: "",
  start_time: "",
  end_time: "",
  location: "",
  max_attendees: "",
  requires_bg_check: false,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminEvents() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);

  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);

  /* ---------- Fetch ---------- */

  const fetchEvents = useCallback(async () => {
    const { data } = await supabase
      .from("events")
      .select("*")
      .order("event_date", { ascending: true });
    if (data) setEvents(data as EventRow[]);
  }, []);

  useEffect(() => {
    fetchEvents().then(() => setLoading(false));
  }, [fetchEvents]);

  /* ---------- Dialog ---------- */

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(ev: EventRow) {
    setEditingId(ev.id);
    setForm({
      title: ev.title,
      description: ev.description ?? "",
      event_date: ev.event_date,
      start_time: ev.start_time,
      end_time: ev.end_time,
      location: ev.location ?? "",
      max_attendees: ev.max_attendees?.toString() ?? "",
      requires_bg_check: ev.requires_bg_check,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.event_date || !form.start_time || !form.end_time) {
      toast({ variant: "destructive", title: "Please fill in all required fields." });
      return;
    }

    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      event_date: form.event_date,
      start_time: form.start_time,
      end_time: form.end_time,
      location: form.location.trim() || null,
      max_attendees: form.max_attendees ? Number(form.max_attendees) : null,
      requires_bg_check: form.requires_bg_check,
    };

    const { error } = editingId
      ? await supabase.from("events").update(payload).eq("id", editingId)
      : await supabase.from("events").insert({ ...payload, created_by: user!.id });

    setSaving(false);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: editingId ? "Event updated" : "Event created" });
      setDialogOpen(false);
      fetchEvents();
    }
  }

  /* ---------- Delete ---------- */

  async function executeDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from("events").delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Event deleted" });
      fetchEvents();
    }
    setDeleteTarget(null);
  }

  /* ---------- Helpers ---------- */

  function isPast(ev: EventRow) {
    return new Date(`${ev.event_date}T${ev.end_time}`) < new Date();
  }

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[#006B3E]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        <Button onClick={openCreate} className="bg-[#006B3E] hover:bg-[#005a33]">
          <Plus className="mr-2 h-4 w-4" /> Create Event
        </Button>
      </div>

      {events.length === 0 && (
        <p className="py-12 text-center text-gray-500">
          No events yet. Create one to get started.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((ev) => (
          <Card
            key={ev.id}
            className={isPast(ev) ? "opacity-60" : ""}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">{ev.title}</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(ev)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-600"
                    onClick={() => setDeleteTarget(ev)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {ev.description && (
                <CardDescription className="line-clamp-2">
                  {ev.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5" />
                {ev.event_date}
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
                {ev.max_attendees ? `Max ${ev.max_attendees}` : "Unlimited"}
              </div>
              <div className="pt-1">
                {ev.requires_bg_check && (
                  <Badge variant="outline" className="text-xs border-[#006B3E] text-[#006B3E]">
                    BG Check Required
                  </Badge>
                )}
                {isPast(ev) && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    Past
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---- Create / Edit Dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Event" : "Create Event"}</DialogTitle>
            <DialogDescription>
              Configure the event details below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Spring Volunteer Day"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={3}
                className="resize-none"
                placeholder="What's this event about?"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input
                type="date"
                value={form.event_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, event_date: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start Time *</Label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start_time: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Time *</Label>
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end_time: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input
                value={form.location}
                onChange={(e) =>
                  setForm((f) => ({ ...f, location: e.target.value }))
                }
                placeholder="e.g. Main Campus, Room 201"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Max Attendees</Label>
              <Input
                type="number"
                min={1}
                value={form.max_attendees}
                onChange={(e) =>
                  setForm((f) => ({ ...f, max_attendees: e.target.value }))
                }
                placeholder="Leave blank for unlimited"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Requires Background Check</p>
                <p className="text-xs text-gray-500">
                  Only cleared volunteers may register.
                </p>
              </div>
              <Switch
                checked={form.requires_bg_check}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, requires_bg_check: v }))
                }
                className="data-[state=checked]:bg-[#006B3E]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#006B3E] hover:bg-[#005a33]"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Save Changes" : "Create Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Confirm ---- */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the event and all registrations. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
