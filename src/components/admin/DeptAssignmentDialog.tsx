import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { AdminDepartment } from "@/hooks/useAdminUsers";

export interface DeptAssignTarget {
  userId: string;
  name: string;
}

interface Props {
  target: DeptAssignTarget | null;
  departments: AdminDepartment[];
  onClose: () => void;
}

/**
 * Department-assignment dialog for coordinators. Self-contained:
 *   - Loads current assignments on open.
 *   - Owns its checkbox-set state and saving flag.
 *   - Performs delete-all + insert-many on save (matches the original
 *     implementation; the trigger model assumes a clean replacement).
 *
 * Page just opens it with a target. No audit-log surface.
 */
export function DeptAssignmentDialog({ target, departments, onClose }: Props) {
  const { toast } = useToast();
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    supabase
      .from("department_coordinators")
      .select("department_id")
      .eq("coordinator_id", target.userId)
      .then(({ data }) => {
        if (cancelled) return;
        const current = new Set(((data || []) as { department_id: string }[]).map((r) => r.department_id));
        setSelectedDepts(current);
      });
    return () => { cancelled = true; };
  }, [target]);

  const toggle = (deptId: string) => {
    setSelectedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  };

  const save = async () => {
    if (!target) return;
    setSaving(true);

    // Replace all assignments: delete then insert. Matches the pre-refactor
    // implementation; the trigger-driven model expects this shape.
    await supabase
      .from("department_coordinators")
      .delete()
      .eq("coordinator_id", target.userId);

    if (selectedDepts.size > 0) {
      const rows = [...selectedDepts].map((deptId) => ({
        coordinator_id: target.userId,
        department_id: deptId,
      }));
      const { error } = await supabase.from("department_coordinators").insert(rows);
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast({
      title: "Departments updated",
      description: `${target.name} is now assigned to ${selectedDepts.size} department${selectedDepts.size !== 1 ? "s" : ""}.`,
    });
    onClose();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Departments</DialogTitle>
          <DialogDescription>
            Select which departments {target?.name} should coordinate. They will see shifts and volunteers for these departments.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-64 overflow-y-auto py-2">
          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active departments found.
            </p>
          ) : (
            departments.map((dept) => (
              <label
                key={dept.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer hover:bg-muted transition-colors"
              >
                <Checkbox
                  checked={selectedDepts.has(dept.id)}
                  onCheckedChange={() => toggle(dept.id)}
                />
                <span className="text-sm">{dept.name}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : `Save (${selectedDepts.size} selected)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
