import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, ToggleLeft, ToggleRight } from "lucide-react";

interface DocType {
  id: string;
  name: string;
  description: string | null;
  is_required: boolean;
  has_expiry: boolean;
  expiry_days: number | null;
  is_active: boolean;
  created_at: string;
}

export default function AdminDocumentTypes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDays, setExpiryDays] = useState("");

  const fetchDocTypes = async () => {
    const { data, error } = await (supabase as any)
      .from("document_types")
      .select("*")
      .order("name");
    if (!error && data) setDocTypes(data as DocType[]);
    setLoading(false);
  };

  useEffect(() => { fetchDocTypes(); }, []);

  const resetForm = () => {
    setName(""); setDescription(""); setIsRequired(false);
    setHasExpiry(false); setExpiryDays(""); setEditingId(null);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  const openEdit = (dt: DocType) => {
    setEditingId(dt.id);
    setName(dt.name);
    setDescription(dt.description || "");
    setIsRequired(dt.is_required);
    setHasExpiry(dt.has_expiry);
    setExpiryDays(dt.expiry_days?.toString() || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name is required." });
      return;
    }
    setSaving(true);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      is_required: isRequired,
      has_expiry: hasExpiry,
      expiry_days: hasExpiry && expiryDays ? parseInt(expiryDays) : null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingId) {
      ({ error } = await (supabase as any).from("document_types").update(payload).eq("id", editingId));
    } else {
      ({ error } = await (supabase as any).from("document_types").insert({ ...payload, created_by: user!.id }));
    }

    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: editingId ? "Document type updated" : "Document type created" });
      setDialogOpen(false);
      resetForm();
      fetchDocTypes();
    }
  };

  const toggleActive = async (dt: DocType) => {
    const { error } = await (supabase as any)
      .from("document_types")
      .update({ is_active: !dt.is_active, updated_at: new Date().toISOString() })
      .eq("id", dt.id);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      fetchDocTypes();
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Document Types</h1>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Type</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manage Document Types</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : docTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No document types defined yet. Click "Add Type" to create one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docTypes.map((dt) => (
                  <TableRow key={dt.id} className={!dt.is_active ? "opacity-50" : ""}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{dt.name}</p>
                        {dt.description && <p className="text-xs text-muted-foreground">{dt.description}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {dt.is_required ? <Badge>Required</Badge> : <Badge variant="outline">Optional</Badge>}
                    </TableCell>
                    <TableCell>
                      {dt.has_expiry ? `${dt.expiry_days} days` : "No expiry"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={dt.is_active ? "default" : "secondary"}>
                        {dt.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(dt)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(dt)}>
                        {dt.is_active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Document Type" : "New Document Type"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Background Check Certificate" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this document is for..." rows={2} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Required</p>
                <p className="text-xs text-muted-foreground">Volunteers must upload this document</p>
              </div>
              <Switch checked={isRequired} onCheckedChange={setIsRequired} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Has Expiry</p>
                <p className="text-xs text-muted-foreground">Document expires after a set number of days</p>
              </div>
              <Switch checked={hasExpiry} onCheckedChange={setHasExpiry} />
            </div>
            {hasExpiry && (
              <div className="space-y-2">
                <Label>Expiry Duration (days)</Label>
                <Input type="number" min="1" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} placeholder="365" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
