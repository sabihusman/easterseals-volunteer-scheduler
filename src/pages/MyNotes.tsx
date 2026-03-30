import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Calendar, Building2, Lock, ChevronDown, ChevronUp } from "lucide-react";
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

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("volunteer_private_notes")
        .select("*, shifts(title, shift_date), departments(name)")
        .eq("volunteer_id", user.id)
        .order("created_at", { ascending: false });
      setNotes(data || []);
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

  const handleExportPDF = async () => {
    // Generate PDF in browser using basic approach
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
        <div class="note-header">${n.shifts?.title || "General Note"}</div>
        <div class="note-info">${n.shifts?.shift_date ? format(new Date(n.shifts.shift_date), "MMM d, yyyy") : ""} — ${n.departments?.name || ""}</div>
        <div class="note-content">${n.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      </div>
    `).join("")}
    </body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
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
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 text-muted-foreground/50" />
          No notes yet. Notes are created when you confirm a shift.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => {
            const locked = isLocked(n);
            const expanded = expandedId === n.id;
            return (
              <Card key={n.id} className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : n.id)}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{n.shifts?.title || "General Note"}</span>
                        {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </div>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        {n.shifts?.shift_date && (
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(n.shifts.shift_date), "MMM d, yyyy")}</span>
                        )}
                        {n.departments?.name && (
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{n.departments.name}</span>
                        )}
                      </div>
                      {!expanded && (
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
                          {!locked && (
                            <Button size="sm" variant="outline" onClick={() => { setEditId(n.id); setEditContent(n.content); }}>
                              Edit Note
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
