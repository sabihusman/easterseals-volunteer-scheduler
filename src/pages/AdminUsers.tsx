import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Search, Lock, Unlock, ShieldCheck, ShieldX } from "lucide-react";

export default function AdminUsers() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from("profiles").select("*").order("full_name");
      setProfiles(data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  const handleToggleActive = async (id: string, current: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_active: !current }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, is_active: !current } : p));
    toast({ title: `User ${!current ? "activated" : "deactivated"}` });
  };

  const handleToggleBooking = async (id: string, current: boolean) => {
    const { error } = await supabase.from("profiles").update({ booking_privileges: !current }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, booking_privileges: !current } : p));
    toast({ title: `Booking privileges ${!current ? "granted" : "revoked"}` });
  };

  const handleBgCheck = async (id: string, status: "cleared" | "pending" | "failed" | "expired") => {
    const { error } = await supabase.from("profiles").update({
      bg_check_status: status,
      bg_check_updated_at: new Date().toISOString(),
      bg_check_expires_at: status === "cleared" ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null,
    }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, bg_check_status: status } : p));
    toast({ title: `Background check: ${status}` });
  };

  const filtered = profiles
    .filter((p) => roleFilter === "all" || p.role === roleFilter)
    .filter((p) => !search || p.full_name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase()));

  const bgBadge = (status: string) => {
    const map: Record<string, string> = { cleared: "bg-success text-success-foreground", pending: "bg-warning text-warning-foreground", failed: "bg-destructive text-destructive-foreground", expired: "bg-muted text-muted-foreground" };
    return <Badge className={`text-xs ${map[status] || ""}`}>{status}</Badge>;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">User Management</h2>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="volunteer">Volunteer</SelectItem>
            <SelectItem value="coordinator">Coordinator</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        {filtered.map((p) => (
          <Card key={p.id}>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.full_name}</span>
                    <Badge variant="secondary" className="text-xs">{p.role}</Badge>
                    {!p.is_active && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground">{p.email}</div>
                  <div className="flex gap-2">
                    {bgBadge(p.bg_check_status)}
                    {!p.booking_privileges && <Badge variant="outline" className="text-xs">No Booking</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleToggleActive(p.id, p.is_active)}>
                    {p.is_active ? <Lock className="h-3 w-3 mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
                    {p.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleToggleBooking(p.id, p.booking_privileges)}>
                    {p.booking_privileges ? "Revoke Booking" : "Grant Booking"}
                  </Button>
                  <Select onValueChange={(v) => handleBgCheck(p.id, v as "cleared" | "pending" | "failed" | "expired")}>
                    <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="BG Check" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cleared">Cleared</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
