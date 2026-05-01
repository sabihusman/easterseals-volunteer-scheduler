import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Department {
  id: string;
  name: string;
  description: string | null;
  requires_bg_check: boolean;
  // (Half B-1: departments.min_age column dropped — was never
  // enforced anywhere. Minor handling now flows through
  // profiles.is_minor + the admin approval queue.)
  allows_groups: boolean;
  is_active: boolean;
  location_id: string;
}

interface LocationOption {
  id: string;
  name: string;
}

interface DeptForm {
  name: string;
  description: string;
  requires_bg_check: boolean;
  allows_groups: boolean;
  location_id: string;
}

const EMPTY_FORM: DeptForm = {
  name: "",
  description: "",
  requires_bg_check: false,
  allows_groups: false,
  location_id: "",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminDepartments() {
  const { toast } = useToast();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DeptForm>(EMPTY_FORM);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [shiftCountForDelete, setShiftCountForDelete] = useState(0);

  /* ---------- Fetch ---------- */

  const fetchDepartments = useCallback(async () => {
    const { data } = await supabase
      .from("departments")
      .select("*")
      .order("name");
    if (data) setDepartments(data as Department[]);
  }, []);

  const fetchLocations = useCallback(async () => {
    const { data } = await supabase
      .from("locations")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    if (data) setLocations(data as LocationOption[]);
  }, []);

  useEffect(() => {
    Promise.all([fetchDepartments(), fetchLocations()]).then(() => setLoading(false));
  }, [fetchDepartments, fetchLocations]);

  /* ---------- Create / Edit Dialog ---------- */

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(dept: Department) {
    setEditingId(dept.id);
    setForm({
      name: dept.name,
      description: dept.description ?? "",
      requires_bg_check: dept.requires_bg_check,
      allows_groups: dept.allows_groups,
      location_id: dept.location_id,
    });
    setDialogOpen(true);
  }

  async function handleSaveDialog() {
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Name is required." });
      return;
    }
    if (!form.location_id) {
      toast({ variant: "destructive", title: "Location is required." });
      return;
    }

    setSaving(true);
    // `location_id` is NOT NULL — always include it (issue #119 fix).
    // (Half B-1 dropped the `min_age` column entirely; it was never
    // enforced. Minor handling now flows through is_minor + the admin
    // approval queue.)
    const basePayload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      requires_bg_check: form.requires_bg_check,
      allows_groups: form.allows_groups,
      location_id: form.location_id,
    };

    // Boundary cast — Supabase's typed insert/update interface doesn't
    // expose the dynamic shape we build here. Pattern documented in
    // eslint.config.js.
    const payload = basePayload as never;

    const { error } = editingId
      ? await supabase.from("departments").update(payload).eq("id", editingId)
      : await supabase.from("departments").insert(payload);

    setSaving(false);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: editingId ? "Department updated" : "Department created" });
      setDialogOpen(false);
      fetchDepartments();
    }
  }

  /* ---------- Inline Rename ---------- */

  function startRename(dept: Department) {
    setRenamingId(dept.id);
    setRenameValue(dept.name);
  }

  async function saveRename() {
    if (!renamingId || !renameValue.trim()) return;

    const { error } = await supabase
      .from("departments")
      .update({ name: renameValue.trim() })
      .eq("id", renamingId);

    if (error) {
      toast({ variant: "destructive", title: "Rename failed", description: error.message });
    } else {
      toast({ title: "Department renamed" });
      fetchDepartments();
    }
    setRenamingId(null);
  }

  /* ---------- Toggle Active ---------- */

  async function toggleActive(dept: Department) {
    const { error } = await supabase
      .from("departments")
      .update({ is_active: !dept.is_active })
      .eq("id", dept.id);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      fetchDepartments();
    }
  }

  /* ---------- Delete ---------- */

  async function confirmDelete(dept: Department) {
    // Check for existing shifts
    const { count } = await supabase
      .from("shifts")
      .select("id", { count: "exact", head: true })
      .eq("department_id", dept.id);

    setShiftCountForDelete(count ?? 0);
    setDeleteTarget(dept);
  }

  async function executeDelete() {
    if (!deleteTarget) return;

    const { error } = await supabase
      .from("departments")
      .delete()
      .eq("id", deleteTarget.id);

    if (error) {
      toast({ variant: "destructive", title: "Delete failed", description: error.message });
    } else {
      toast({ title: "Department deleted" });
      fetchDepartments();
    }
    setDeleteTarget(null);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-foreground">Departments</h1>
        <Button size="sm" onClick={openCreate} className="bg-primary hover:bg-primary/90 whitespace-nowrap">
          <Plus className="mr-1.5 h-4 w-4" /> Add Department
        </Button>
      </div>

      {/* ---- Table ---- */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-center">BG Check</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No departments yet.
                </TableCell>
              </TableRow>
            )}
            {departments.map((dept) => (
              <TableRow key={dept.id}>
                {/* Name — inline rename */}
                <TableCell>
                  {renamingId === dept.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-8 w-48"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                      />
                      <Button variant="ghost" size="icon" onClick={saveRename}>
                        <Check className="h-4 w-4 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRenamingId(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <span
                      className="cursor-pointer font-medium hover:underline"
                      onClick={() => startRename(dept)}
                      title="Click to rename"
                    >
                      {dept.name}
                    </span>
                  )}
                </TableCell>

                {/* BG Check toggle */}
                <TableCell className="text-center">
                  <Switch
                    checked={dept.requires_bg_check}
                    onCheckedChange={async (checked) => {
                      await supabase
                        .from("departments")
                        .update({ requires_bg_check: checked })
                        .eq("id", dept.id);
                      fetchDepartments();
                    }}
                    className="data-[state=checked]:bg-primary"
                  />
                </TableCell>

                {/* Active badge + toggle */}
                <TableCell className="text-center">
                  <Badge
                    variant={dept.is_active ? "default" : "secondary"}
                    className={
                      dept.is_active
                        ? "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                        : "cursor-pointer"
                    }
                    onClick={() => toggleActive(dept)}
                  >
                    {dept.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>

                {/* Actions */}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(dept)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => confirmDelete(dept)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ---- Create / Edit Dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Department" : "New Department"}
            </DialogTitle>
            <DialogDescription>
              Configure the department details below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Therapeutic Recreation"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Location *</Label>
              <Select
                value={form.location_id}
                onValueChange={(v) => setForm((f) => ({ ...f, location_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="What does this department do?"
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Requires Background Check</p>
                <p className="text-xs text-muted-foreground">
                  Volunteers must have a cleared BG check to sign up.
                </p>
              </div>
              <Switch
                checked={form.requires_bg_check}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, requires_bg_check: v }))
                }
                className="data-[state=checked]:bg-primary"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Allows Group Volunteering</p>
                <p className="text-xs text-muted-foreground">
                  Let groups sign up together for shifts.
                </p>
              </div>
              <Switch
                checked={form.allows_groups}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, allows_groups: v }))
                }
                className="data-[state=checked]:bg-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveDialog}
              disabled={saving}
              className="bg-primary hover:bg-primary/90"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Save Changes" : "Create Department"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Confirmation ---- */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>This action cannot be undone.</p>
                {shiftCountForDelete > 0 && (
                  <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      This department has{" "}
                      <strong>{shiftCountForDelete}</strong> existing
                      shift{shiftCountForDelete > 1 ? "s" : ""}. Deleting it
                      may affect scheduled volunteers.
                    </span>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Department
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
