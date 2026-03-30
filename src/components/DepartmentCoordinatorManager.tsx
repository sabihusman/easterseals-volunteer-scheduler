import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, UserPlus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function DepartmentCoordinatorManager() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [coordinators, setCoordinators] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [selectedCoord, setSelectedCoord] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Client-side role check: only admins can see this component
  if (role !== "admin") return null;

  const fetchData = async () => {
    const [{ data: depts }, { data: assigns }, { data: coords }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
      supabase.from("department_coordinators").select("department_id, coordinator_id, profiles(full_name, email)"),
      supabase.from("profiles").select("id, full_name, email").eq("role", "coordinator").eq("is_active", true).order("full_name"),
    ]);
    setDepartments(depts || []);
    setAssignments(assigns || []);
    setCoordinators(coords || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleAssign = async () => {
    if (!selectedDept || !selectedCoord) return;
    const { error } = await supabase.from("department_coordinators").insert({
      department_id: selectedDept,
      coordinator_id: selectedCoord,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Coordinator assigned" });
      setSelectedCoord("");
      fetchData();
    }
  };

  const handleRemove = async (deptId: string, coordId: string) => {
    const { error } = await supabase.from("department_coordinators")
      .delete()
      .eq("department_id", deptId)
      .eq("coordinator_id", coordId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Coordinator removed" });
      fetchData();
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Building2 className="h-5 w-5" /> Department Management
      </h3>

      <div className="grid gap-3">
        {departments.map((dept) => {
          const deptAssigns = assignments.filter((a) => a.department_id === dept.id);
          return (
            <Card key={dept.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{dept.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {deptAssigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No coordinators assigned</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {deptAssigns.map((a) => (
                      <Badge key={a.coordinator_id} variant="secondary" className="flex items-center gap-1 pr-1">
                        {a.profiles?.full_name || a.profiles?.email}
                        <button
                          onClick={() => handleRemove(dept.id, a.coordinator_id)}
                          className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                          aria-label={`Remove ${a.profiles?.full_name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <Select value={selectedDept === dept.id ? selectedCoord : ""} onValueChange={(v) => { setSelectedDept(dept.id); setSelectedCoord(v); }}>
                    <SelectTrigger className="h-8 w-[200px] text-xs">
                      <SelectValue placeholder="Add coordinator..." />
                    </SelectTrigger>
                    <SelectContent>
                      {coordinators
                        .filter((c) => !deptAssigns.some((a) => a.coordinator_id === c.id))
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedDept !== dept.id || !selectedCoord}
                    onClick={handleAssign}
                  >
                    <UserPlus className="h-3 w-3 mr-1" />Assign
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
