import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { RestrictVolunteerModal } from "@/components/RestrictVolunteerModal";

interface Props {
  departmentIds: string[];
  departments: { id: string; name: string }[];
}

interface VolunteerEntry {
  volunteerId: string;
  volunteerName: string;
  departmentId: string;
  departmentName: string;
  isRestricted: boolean;
  restrictionId?: string;
}

export function DepartmentVolunteersTab({ departmentIds, departments }: Props) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<VolunteerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (departmentIds.length === 0) return;
    const [{ data: bookings }, { data: restrictions }] = await Promise.all([
      supabase
        .from("shift_bookings")
        .select("volunteer_id, profiles!shift_bookings_volunteer_id_fkey(full_name), shifts!shift_bookings_shift_id_fkey(department_id)")
        .eq("booking_status", "confirmed"),
      supabase
        .from("department_restrictions")
        .select("id, volunteer_id, department_id")
        .in("department_id", departmentIds),
    ]);

    // Build unique volunteer-department pairs
    const seen = new Set<string>();
    const result: VolunteerEntry[] = [];
    for (const b of (bookings || [])) {
      if (!b.shifts || !departmentIds.includes(b.shifts.department_id)) continue;
      const key = `${b.volunteer_id}-${b.shifts.department_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const restriction = (restrictions || []).find(
        (r: any) => r.volunteer_id === b.volunteer_id && r.department_id === b.shifts.department_id
      );
      const dept = departments.find((d) => d.id === b.shifts.department_id);
      result.push({
        volunteerId: b.volunteer_id,
        volunteerName: b.profiles?.full_name || "Unknown",
        departmentId: b.shifts.department_id,
        departmentName: dept?.name || "",
        isRestricted: !!restriction,
        restrictionId: restriction?.id,
      });
    }
    result.sort((a, b) => a.volunteerName.localeCompare(b.volunteerName));
    setEntries(result);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [departmentIds]);

  const handleRemoveRestriction = async (restrictionId: string) => {
    const { error } = await supabase.from("department_restrictions").delete().eq("id", restrictionId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Restriction removed" });
      fetchData();
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading volunteers...</p>;

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No volunteers have booked shifts in your department yet.</p>
      ) : (
        entries.map((e) => (
          <div key={`${e.volunteerId}-${e.departmentId}`} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">{e.volunteerName}</div>
              <div className="text-xs text-muted-foreground">{e.departmentName}</div>
            </div>
            <div className="flex items-center gap-2">
              {e.isRestricted ? (
                <>
                  <Badge variant="destructive" className="text-xs">Restricted</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => handleRemoveRestriction(e.restrictionId!)}
                  >
                    <ShieldCheck className="h-3 w-3 mr-1" />Unrestrict
                  </Button>
                </>
              ) : (
                <RestrictVolunteerModal
                  volunteerId={e.volunteerId}
                  volunteerName={e.volunteerName}
                  departmentId={e.departmentId}
                  departmentName={e.departmentName}
                  onDone={fetchData}
                />
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
