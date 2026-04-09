import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DocumentStatusBadge } from "@/components/DocumentStatusBadge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, XCircle, Download, Eye } from "lucide-react";
import { format } from "date-fns";

interface DocType {
  id: string;
  name: string;
  is_required: boolean;
}

interface VolDoc {
  id: string;
  volunteer_id: string;
  document_type_id: string;
  file_name: string;
  storage_path: string;
  status: string;
  review_note: string | null;
  expires_at: string | null;
  uploaded_at: string;
  volunteer_name?: string;
  volunteer_email?: string;
}

interface Volunteer {
  id: string;
  full_name: string;
  email: string;
}

export default function DocumentCompliance() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [allDocs, setAllDocs] = useState<VolDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Review dialog
  const [reviewDoc, setReviewDoc] = useState<VolDoc | null>(null);
  const [reviewStatus, setReviewStatus] = useState("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  const fetchData = async () => {
    const [typesRes, volsRes, docsRes] = await Promise.all([
      (supabase as any).from("document_types").select("id, name, is_required").eq("is_active", true).order("name"),
      supabase.from("profiles").select("id, full_name, email").eq("role", "volunteer").order("full_name"),
      (supabase as any).from("volunteer_documents").select("*").order("uploaded_at", { ascending: false }),
    ]);
    if (typesRes.data) setDocTypes(typesRes.data as DocType[]);
    if (volsRes.data) setVolunteers(volsRes.data as Volunteer[]);
    if (docsRes.data) setAllDocs(docsRes.data as VolDoc[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const requiredTypes = docTypes.filter((dt) => dt.is_required);

  const getVolunteerCompliance = (volId: string) => {
    const volDocs = allDocs.filter((d) => d.volunteer_id === volId);
    const completed = requiredTypes.filter((rt) =>
      volDocs.some((d) => d.document_type_id === rt.id && d.status === "approved")
    ).length;
    const pending = requiredTypes.filter((rt) =>
      volDocs.some((d) => d.document_type_id === rt.id && d.status === "pending_review")
    ).length;
    return { completed, pending, total: requiredTypes.length };
  };

  const getDocStatus = (volId: string, typeId: string): string => {
    const doc = allDocs.find(
      (d) => d.volunteer_id === volId && d.document_type_id === typeId && d.status !== "rejected"
    );
    return doc?.status || "missing";
  };

  const getDoc = (volId: string, typeId: string): VolDoc | undefined => {
    return allDocs.find(
      (d) => d.volunteer_id === volId && d.document_type_id === typeId && d.status !== "rejected"
    );
  };

  const handleReview = async () => {
    if (!reviewDoc || !user) return;
    setReviewSaving(true);

    const { error } = await (supabase as any)
      .from("volunteer_documents")
      .update({
        status: reviewStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reviewDoc.id);

    setReviewSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: `Document ${reviewStatus}` });
      setReviewDoc(null);
      setReviewNote("");
      fetchData();
    }
  };

  const handleDownload = async (storagePath: string) => {
    const { data, error } = await supabase.storage
      .from("volunteer-documents")
      .createSignedUrl(storagePath, 60);
    if (error || !data?.signedUrl) {
      toast({ variant: "destructive", title: "Error", description: "Could not generate download link." });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const filteredVolunteers = volunteers.filter((v) => {
    const matchesSearch = !searchTerm ||
      v.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.email?.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filterStatus === "all") return true;
    const { completed, total } = getVolunteerCompliance(v.id);
    if (filterStatus === "complete") return completed === total && total > 0;
    if (filterStatus === "incomplete") return completed < total;
    return true;
  });

  if (loading) return <div className="flex justify-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Document Compliance</h1>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <Input
          placeholder="Search volunteers..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full sm:max-w-xs"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Volunteers</SelectItem>
            <SelectItem value="complete">Fully Compliant</SelectItem>
            <SelectItem value="incomplete">Incomplete</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-primary">{volunteers.length}</p>
            <p className="text-sm text-muted-foreground">Total Volunteers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-green-600">
              {volunteers.filter((v) => {
                const { completed, total } = getVolunteerCompliance(v.id);
                return completed === total && total > 0;
              }).length}
            </p>
            <p className="text-sm text-muted-foreground">Fully Compliant</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-amber-600">
              {allDocs.filter((d) => d.status === "pending_review").length}
            </p>
            <p className="text-sm text-muted-foreground">Pending Review</p>
          </CardContent>
        </Card>
      </div>

      {/* Compliance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Volunteer Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {requiredTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No required document types defined. Go to Document Types to create some.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Volunteer</TableHead>
                    {requiredTypes.map((rt) => (
                      <TableHead key={rt.id} className="text-center">{rt.name}</TableHead>
                    ))}
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVolunteers.map((v) => {
                    const { completed, total } = getVolunteerCompliance(v.id);
                    return (
                      <TableRow key={v.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{v.full_name || "—"}</p>
                            <p className="text-xs text-muted-foreground">{v.email}</p>
                          </div>
                        </TableCell>
                        {requiredTypes.map((rt) => {
                          const status = getDocStatus(v.id, rt.id);
                          const doc = getDoc(v.id, rt.id);
                          return (
                            <TableCell key={rt.id} className="text-center">
                              <div className="flex items-center justify-center gap-1">
                                <DocumentStatusBadge status={status} />
                                {doc && doc.status === "pending_review" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() => {
                                      setReviewDoc({ ...doc, volunteer_name: v.full_name, volunteer_email: v.email });
                                      setReviewStatus("approved");
                                      setReviewNote("");
                                    }}
                                  >
                                    <Eye className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center">
                          <Badge variant={completed === total ? "default" : "secondary"}>
                            {completed}/{total}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!reviewDoc} onOpenChange={(open) => !open && setReviewDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Document</DialogTitle>
          </DialogHeader>
          {reviewDoc && (
            <div className="space-y-4 py-2">
              <div>
                <p className="text-sm font-medium">{reviewDoc.volunteer_name}</p>
                <p className="text-xs text-muted-foreground">{reviewDoc.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  Uploaded {format(new Date(reviewDoc.uploaded_at), "MMM d, yyyy")}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleDownload(reviewDoc.storage_path)}>
                <Download className="h-4 w-4 mr-2" /> View / Download
              </Button>
              <div className="space-y-2">
                <p className="text-sm font-medium">Decision</p>
                <div className="flex gap-2">
                  <Button
                    variant={reviewStatus === "approved" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setReviewStatus("approved")}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button
                    variant={reviewStatus === "rejected" ? "destructive" : "outline"}
                    size="sm"
                    onClick={() => setReviewStatus("rejected")}
                  >
                    <XCircle className="h-4 w-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Note (optional)</p>
                <Textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Reason for approval/rejection..."
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDoc(null)}>Cancel</Button>
            <Button onClick={handleReview} disabled={reviewSaving}>
              {reviewSaving ? "Saving..." : "Submit Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
