import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldCheck, ShieldX, UserPlus, X, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

interface Department {
  id: string;
  name: string;
  requires_bg_check: boolean;
}

interface CoordinatorProfile {
  id: string;
  full_name: string;
  email: string;
}

interface Assignment {
  department_id: string;
  coordinator_id: string;
  profiles: CoordinatorProfile;
}

export default function DepartmentManagement() {
  const { toast } = useToast();
  const { role } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [coordinators, setCoordinators] = useState<CoordinatorProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Assign modal
  const [assignDept, setAssignDept] = useState<Department | null>(null);
  const [coordSearch, setCoordSearch] = useState("");
  const [selectedCoord, setSelectedCoord] = useState<CoordinatorProfile | null>(null);
  const [assigning, setAssigning] = useState(false);

  // Remove confirmation
  const [removeTarget, setRemoveTarget] = useState<{ dept: Department; coord: CoordinatorProfile } | null>(null);
  const [removing, setRemoving] = useState(false);

  const fetchData = async () => {
    const [deptRes, assignRes, coordRes] = await Promise.all([
      supabase.from("departments").select("id, name, requires_bg_check").eq("is_active", true).order("name"),
      supabase.from("department_coordinators").select("department_id, coordinator_id, profiles:coordinator_id(id, full_name, email)"),
      supabase.from("profiles").select("id, full_name, email").eq("role", "coordinator").order("full_name"),
    ]);
    setDepartments(deptRes.data || []);
    setAssignments((assignRes.data as any) || []);
    setCoordinators(coordRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  if (role !== "admin") return null;

  const getAssignedCoords = (deptId: string) =>
    assignments.filter((a) => a.department_id === deptId).map((a) => a.profiles);

  const getAvailableCoords = (deptId: string) => {
    const assignedIds = new Set(assignments.filter((a) => a.department_id === deptId).map((a) => a.coordinator_id));
    return coordinators.filter((c) => !assignedIds.has(c.id));
  };

  const handleAssign = async () => {
    if (!assignDept || !selectedCoord) return;
    setAssigning(true);

    // Check if already assigned
    const existing = assignments.find(
      (a) => a.department_id === assignDept.id && a.coordinator_id === selectedCoord.id
    );
    if (existing) {
      toast({ title: "Already assigned", description: `${selectedCoord.full_name} is already assigned to ${assignDept.name}.`, variant: "destructive" });
      setAssigning(false);
      return;
    }

    const { error } = await supabase.from("department_coordinators").insert({
      department_id: assignDept.id,
      coordinator_id: selectedCoord.id,
    });

    setAssigning(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: `${selectedCoord.full_name} assigned to ${assignDept.name}` });
    setAssignDept(null);
    setSelectedCoord(null);
    setCoordSearch("");
    fetchData();
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);

    const { error } = await supabase
      .from("department_coordinators")
      .delete()
      .eq("department_id", removeTarget.dept.id)
      .eq("coordinator_id", removeTarget.coord.id);

    setRemoving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: `${removeTarget.coord.full_name} removed from ${removeTarget.dept.name}` });
    setRemoveTarget(null);
    fetchData();
  };

  const avatarInitial = (name: string) => name?.charAt(0)?.toUpperCase() || "?";

  if (loading) {
    return <div className="max-w-5xl mx-auto py-8 text-center text-muted-foreground">Loading departments...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Department Management</h2>
      <p className="text-sm text-muted-foreground">Assign and manage coordinators for each department.</p>

      <div className="grid gap-4 md:grid-cols-2">
        {departments.map((dept) => {
          const assigned = getAssignedCoords(dept.id);
          return (
            <Card key={dept.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{dept.name}</CardTitle>
                  <Badge className={`text-xs ${dept.requires_bg_check ? "bg-warning text-warning-foreground" : "bg-muted text-muted-foreground"}`}>
                    {dept.requires_bg_check ? (
                      <><ShieldCheck className="h-3 w-3 mr-1" />BG Required</>
                    ) : (
                      <><ShieldX className="h-3 w-3 mr-1" />No BG Check</>
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {assigned.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No coordinators assigned</p>
                ) : (
                  <div className="space-y-2">
                    {assigned.map((coord) => (
                      <div key={coord.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                            {avatarInitial(coord.full_name)}
                          </div>
                          <div>
                            <p className="text-sm font-medium leading-tight">{coord.full_name}</p>
                            <p className="text-xs text-muted-foreground">{coord.email}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setRemoveTarget({ dept, coord })}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1"
                  onClick={() => { setAssignDept(dept); setSelectedCoord(null); setCoordSearch(""); }}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Assign Coordinator
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Assign coordinator modal */}
      <Dialog open={!!assignDept} onOpenChange={(open) => { if (!open) { setAssignDept(null); setSelectedCoord(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Coordinator</DialogTitle>
            <DialogDescription>
              Select a coordinator to assign to <strong>{assignDept?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <Command className="border rounded-md">
            <CommandInput placeholder="Search coordinators..." value={coordSearch} onValueChange={setCoordSearch} />
            <CommandList>
              <CommandEmpty>No coordinators found.</CommandEmpty>
              <CommandGroup>
                {assignDept && getAvailableCoords(assignDept.id)
                  .filter((c) =>
                    !coordSearch ||
                    c.full_name.toLowerCase().includes(coordSearch.toLowerCase()) ||
                    c.email.toLowerCase().includes(coordSearch.toLowerCase())
                  )
                  .map((coord) => (
                    <CommandItem
                      key={coord.id}
                      value={`${coord.full_name} ${coord.email}`}
                      onSelect={() => setSelectedCoord(coord)}
                      className={`cursor-pointer ${selectedCoord?.id === coord.id ? "bg-accent" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                          {avatarInitial(coord.full_name)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{coord.full_name}</p>
                          <p className="text-xs text-muted-foreground">{coord.email}</p>
                        </div>
                      </div>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>

          {selectedCoord && (
            <div className="p-2 rounded-md bg-accent/50 text-sm">
              Selected: <strong>{selectedCoord.full_name}</strong>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignDept(null); setSelectedCoord(null); }}>Cancel</Button>
            <Button onClick={handleAssign} disabled={!selectedCoord || assigning}>
              {assigning ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Coordinator</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{removeTarget?.coord.full_name}</strong> from <strong>{removeTarget?.dept.name}</strong>? They will lose access to this department's shifts and volunteers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} disabled={removing}>
              {removing ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
