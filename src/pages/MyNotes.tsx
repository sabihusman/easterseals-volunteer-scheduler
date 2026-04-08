import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, FileText, Calendar, Building2, Lock, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

export default function MyNotes() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // Add note modal
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newNoteType, setNewNoteType] = useState<"standalone" | "linked">("standalone");
  const [newShiftId, setNewShiftId] = useState<string | null>(null);
  const [newDeptId, setNewDeptId] = useState<string | null>(null);
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [allDepartments, setAllDepartments] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [{ data: noteData }, { data: deptData }] = await Promise.all([
        supabase
          .from("volunteer_private_notes")
          .select("*, shifts(title, shift_date), departments(name)")
          .eq("volunteer_id", user.id)
          .order("created_at", { ascending: false }),
        supabase.from("departments").select("id, name").eq("is_active", true),
      ]);

      // Auto-lock notes older than 7 days
      const now = new Date();
      const loaded = (noteData || []).map((n: any) => ({
        ...n,
        is_locked: n.is_locked || differenceInDays(now, new Date(n.created_at)) > 7,
      }));
      setNotes(loaded);
      setAllDepartments(deptData || []);
      setLoading(false);
    };
    load();
  }, [user]);

  const departments = useMemo(() => {
    const depts = new Map<string, string>();
    notes.forEach((n) => {
      if (n.department_id && n.departments?.name) depts.set(n.department_id, n.departments.name);
    });
    return Array.from(depts.entries());
  }, [notes]);

  const filtered = deptFilter === "all" ? notes : notes.filter((n) => n.department_id === deptFilter);

  const linkedNotes = filtered.filter((n) => n.shift_id);
  const standaloneNotes = filtered.filter((n) => !n.shift_id);

  const isLocked = (note: any) => {
    return note.is_locked || differenceInDays(new Date(), new Date(note.created_at)) > 7;
  };

  const handleSaveEdit = async (noteId: string) => {
    const { error } = await supabase
      .from("volunteer_private_notes")
      .update({ content: editContent.trim() })
      .eq("id", noteId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setNotes((prev) => prev.map((n) => n.id === noteId ? { ...n, content: editContent.trim() } : n));
      setEditId(null);
      toast({ title: "Note updated" });
    }
  };

  const handleDelete = async (note: any) => {
    const { error } = await supabase
      .from("volunteer_private_notes")
      .delete()
      .eq("id", note.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      toast({ title: "Note deleted" });
    }
    setDeleteTarget(null);
  };

  const openAddModal = async () => {
    setNewTitle("");
    setNewContent("");
    setNewNoteType("standalone");
    setNewShiftId(null);
    setNewDeptId(null);
    // Fetch bookings for linking
    if (user) {
      const { data } = await supabase
        .from("shift_bookings")
        .select("id, shifts(id, title, shift_date)")
        .eq("volunteer_id", user.id)
        .eq("booking_status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(50);
      setMyBookings((data || []).filter((b: any) => b.shifts));
    }
    setAddOpen(true);
  };

  const handleAddNote = async () => {
    if (!newContent.trim()) {
      toast({ title: "Content is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("volunteer_private_notes")
      .insert({
        volunteer_id: user!.id,
        title: newTitle.trim() || null,
        content: newContent.trim(),
        shift_id: newNoteType === "linked" ? newShiftId : null,
        department_id: newDeptId || null,
      })
      .select("*, shifts(title, shift_date), departments(name)")
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setNotes((prev) => [data, ...prev]);
      setAddOpen(false);
      toast({ title: "Note added" });
    }
  };

  const handleExportPDF = async () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast({ title: "Please allow popups to export PDF", variant: "destructive" }); return; }

    const html = `<!DOCTYPE html><html><head><title>My Volunteer Notes</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 40px; color: #1a1a1a; }
      h1 { color: #006B3E; border-bottom: 2px solid #006B3E; padding-bottom: 8px; }
      .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
      .note { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
      .note-header { font-weight: bold; margin-bottom: 4px; }
      .note-info { color: #666; font-size: 12px; margin-bottom: 8px; }
      .note-content { white-space: pre-wrap; line-height: 1.6; }
      @media print { body { padding: 20px; } }
    </style></head><body>
    <h1>My Volunteer Notes</h1>
    <div class="meta">Exported by ${profile?.full_name || "Volunteer"} on ${format(new Date(), "MMMM d, yyyy")}</div>
    ${filtered.map((n) => `
      <div class="note">
        <div class="note-header">${n.title || n.shifts?.title || "General Note"}</div>
        <div class="note-info">${n.shifts?.shift_date ? format(new Date(n.shifts.shift_date + "T00:00:00"), "MMM d, yyyy") : ""} — ${n.departments?.name || ""}</div>
        <div class="note-content">${n.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      </div>
    `).join("")}
    </body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  };

  const renderNoteCard = (n: any) => {
    const locked = isLocked(n);
    const expanded = expandedId === n.id;
    const displayTitle = n.title || (n.content.length > 60 ? n.content.slice(0, 60) + "…" : n.content);

    return (
      <Card key={n.id} className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : n.id)}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{displayTitle}</span>
                {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                {n.departments?.name && (
                  <Badge variant="secondary" className="text-[10px]">{n.departments.name}</Badge>
                )}
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                {n.shifts?.title && (
                  <span className="flex items-center gap-1">📋 {n.shifts.title}</span>
                )}
                {n.shifts?.shift_date && (
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(n.shifts.shift_date + "T00:00:00"), "MMM d, yyyy")}</span>
                )}
                <span>{format(new Date(n.created_at), "MMM d, yyyy")}</span>
              </div>
              {!expanded && !n.title && (
                <p className="text-sm text-muted-foreground truncate">{n.content}</p>
              )}
            </div>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>

          {expanded && (
            <div className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
              {editId === n.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value.slice(0, 2000))}
                    maxLength={2000}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSaveEdit(n.id)}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                  <div className="flex gap-2">
                    {!locked && (
                      <Button size="sm" variant="outline" onClick={() => { setEditId(n.id); setEditContent(n.content); }}>
                        Edit Note
                      </Button>
                    )}
                    {!locked && (
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(n)}>
                        <Trash2 className="h-3 w-3 mr-1" />Delete
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (loading) return <p className="text-muted-foreground p-6">Loading notes...</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">My Notes</h2>
          <p className="text-muted-foreground">Private notes from your shifts</p>
        </div>
        <div className="flex gap-2">
          {departments.length > 0 && (
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" />Export PDF
          </Button>
          <Button size="sm" onClick={openAddModal}>
            <Plus className="h-4 w-4 mr-1" />Add Note
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 text-muted-foreground/50" />
          No notes yet. Click "Add Note" to create one, or notes are created when you confirm a shift.
        </CardContent></Card>
      ) : (
        <div className="space-y-6">
          {linkedNotes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Linked to Shift</h3>
              {linkedNotes.map(renderNoteCard)}
            </div>
          )}
          {standaloneNotes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Standalone</h3>
              {standaloneNotes.map(renderNoteCard)}
            </div>
          )}
        </div>
      )}

      {/* Add Note Modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add Note</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title (optional)</Label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value.slice(0, 100))} placeholder="Note title" maxLength={100} />
              <p className="text-xs text-muted-foreground text-right">{newTitle.length}/100</p>
            </div>
            <div className="space-y-2">
              <Label>Note type</Label>
              <Select value={newNoteType} onValueChange={(v) => setNewNoteType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standalone">Standalone note</SelectItem>
                  <SelectItem value="linked">Link to a shift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newNoteType === "linked" && (
              <div className="space-y-2">
                <Label>Select shift</Label>
                <Select value={newShiftId || ""} onValueChange={setNewShiftId}>
                  <SelectTrigger><SelectValue placeholder="Choose a shift" /></SelectTrigger>
                  <SelectContent>
                    {myBookings.map((b: any) => (
                      <SelectItem key={b.shifts.id} value={b.shifts.id}>
                        {b.shifts.title} — {format(new Date(b.shifts.shift_date + "T00:00:00"), "MMM d, yyyy")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Department (optional)</Label>
              <Select value={newDeptId || "none"} onValueChange={(v) => setNewDeptId(v === "none" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {allDepartments.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Content <span className="text-destructive">*</span></Label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value.slice(0, 2000))}
                maxLength={2000}
                rows={5}
                placeholder="Write your note..."
              />
              <p className="text-xs text-muted-foreground text-right">{newContent.length}/2000</p>
            </div>
            <Button onClick={handleAddNote} disabled={saving || !newContent.trim()} className="w-full">
              {saving ? "Saving..." : "Save Note"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDelete(deleteTarget)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
