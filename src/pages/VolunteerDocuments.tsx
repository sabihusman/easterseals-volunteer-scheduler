import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DocumentStatusBadge } from "@/components/DocumentStatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileText, Download, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { format, differenceInDays } from "date-fns";

interface DocType {
  id: string;
  name: string;
  description: string | null;
  is_required: boolean;
  has_expiry: boolean;
  expiry_days: number | null;
}

interface VolunteerDoc {
  id: string;
  document_type_id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  storage_path: string;
  status: string;
  review_note: string | null;
  expires_at: string | null;
  uploaded_at: string;
}

export default function VolunteerDocuments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [myDocs, setMyDocs] = useState<VolunteerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [customExpiry, setCustomExpiry] = useState<Record<string, string>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchData = async () => {
    if (!user) return;
    const [typesRes, docsRes] = await Promise.all([
      (supabase as any).from("document_types").select("*").eq("is_active", true).order("name"),
      (supabase as any).from("volunteer_documents").select("*").eq("volunteer_id", user.id).order("uploaded_at", { ascending: false }),
    ]);
    if (typesRes.data) setDocTypes(typesRes.data as DocType[]);
    if (docsRes.data) setMyDocs(docsRes.data as VolunteerDoc[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const getDocForType = (typeId: string): VolunteerDoc | undefined => {
    return myDocs.find((d) => d.document_type_id === typeId && d.status !== "rejected");
  };

  const handleUpload = async (typeId: string, file: File) => {
    if (!user) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "Maximum file size is 10MB." });
      return;
    }

    setUploading(typeId);
    const ext = file.name.split(".").pop();
    const storagePath = `${user.id}/${typeId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("volunteer-documents")
      .upload(storagePath, file);

    if (uploadError) {
      toast({ variant: "destructive", title: "Upload failed", description: uploadError.message });
      setUploading(null);
      return;
    }

    // Calculate expiry: manual override takes precedence, then auto from doc type
    const docType = docTypes.find((dt) => dt.id === typeId);
    const manualExpiry = customExpiry[typeId];
    const expiresAt = manualExpiry
      ? new Date(manualExpiry + "T23:59:59").toISOString()
      : docType?.has_expiry && docType.expiry_days
        ? new Date(Date.now() + docType.expiry_days * 86400000).toISOString()
        : null;

    const { error: insertError } = await (supabase as any).from("volunteer_documents").insert({
      volunteer_id: user.id,
      document_type_id: typeId,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      storage_path: storagePath,
      expires_at: expiresAt,
    });

    setUploading(null);
    if (insertError) {
      toast({ variant: "destructive", title: "Error", description: insertError.message });
    } else {
      toast({ title: "Document uploaded", description: "Your document is pending review." });
      fetchData();
    }
  };

  const handleDelete = async (doc: VolunteerDoc) => {
    await supabase.storage.from("volunteer-documents").remove([doc.storage_path]);
    const { error } = await (supabase as any).from("volunteer_documents").delete().eq("id", doc.id);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      toast({ title: "Document removed" });
      fetchData();
    }
  };

  const handleDownload = async (doc: VolunteerDoc) => {
    const { data, error } = await supabase.storage
      .from("volunteer-documents")
      .createSignedUrl(doc.storage_path, 60);
    if (error || !data?.signedUrl) {
      toast({ variant: "destructive", title: "Error", description: "Could not generate download link." });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  if (loading) return <div className="flex justify-center py-12 text-muted-foreground">Loading...</div>;

  const requiredTypes = docTypes.filter((dt) => dt.is_required);
  const optionalTypes = docTypes.filter((dt) => !dt.is_required);
  const completedRequired = requiredTypes.filter((dt) => {
    const doc = getDocForType(dt.id);
    return doc && doc.status === "approved";
  }).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Documents</h1>
        {requiredTypes.length > 0 && (
          <Badge variant={completedRequired === requiredTypes.length ? "default" : "secondary"}>
            {completedRequired}/{requiredTypes.length} required completed
          </Badge>
        )}
      </div>

      {requiredTypes.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" /> Required Documents
          </h2>
          {requiredTypes.map((dt) => renderDocCard(dt, true))}
        </div>
      )}

      {optionalTypes.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Optional Documents</h2>
          {optionalTypes.map((dt) => renderDocCard(dt, false))}
        </div>
      )}

      {docTypes.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-primary" />
            <p>No document requirements have been set up yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );

  function renderDocCard(dt: DocType, required: boolean) {
    const doc = getDocForType(dt.id);
    const isExpiringSoon = doc?.expires_at && differenceInDays(new Date(doc.expires_at), new Date()) <= 30;

    return (
      <Card key={dt.id} className={required && !doc ? "border-amber-300" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{dt.name}</CardTitle>
            {doc ? (
              <DocumentStatusBadge status={doc.status} />
            ) : (
              <DocumentStatusBadge status="missing" />
            )}
          </div>
          {dt.description && <CardDescription>{dt.description}</CardDescription>}
        </CardHeader>
        <CardContent>
          {doc ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span>{doc.file_name}</span>
                  <span className="text-muted-foreground">{formatFileSize(doc.file_size)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleDownload(doc)}>
                    <Download className="h-4 w-4" />
                  </Button>
                  {doc.status === "pending_review" && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(doc)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Uploaded {format(new Date(doc.uploaded_at), "MMM d, yyyy")}
              </p>
              {doc.review_note && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                  Reviewer note: {doc.review_note}
                </p>
              )}
              {doc.expires_at && (
                <p className={`text-xs ${isExpiringSoon ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                  Expires: {format(new Date(doc.expires_at), "MMM d, yyyy")}
                  {isExpiringSoon && " — expiring soon!"}
                </p>
              )}
              {(doc.status === "rejected" || doc.status === "expired") && (
                <div className="pt-2">
                  <input
                    type="file"
                    ref={(el) => { fileInputRefs.current[dt.id] = el; }}
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(dt.id, f);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRefs.current[dt.id]?.click()}
                    disabled={uploading === dt.id}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploading === dt.id ? "Uploading..." : "Re-upload"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <input
                type="file"
                ref={(el) => { fileInputRefs.current[dt.id] = el; }}
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(dt.id, f);
                }}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRefs.current[dt.id]?.click()}
                disabled={uploading === dt.id}
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploading === dt.id ? "Uploading..." : "Upload Document"}
              </Button>
              <div className="mt-3 space-y-1.5">
                <Label htmlFor={`expiry-${dt.id}`} className="text-xs text-muted-foreground">
                  Expiration date (optional)
                </Label>
                <Input
                  id={`expiry-${dt.id}`}
                  type="date"
                  value={customExpiry[dt.id] || ""}
                  onChange={(e) => setCustomExpiry((prev) => ({ ...prev, [dt.id]: e.target.value }))}
                  className="w-full sm:w-48"
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Accepted: PDF, JPG, PNG, DOC, DOCX (max 10MB)
                {dt.has_expiry && dt.expiry_days && !customExpiry[dt.id] && ` — auto-expires ${dt.expiry_days} days after upload`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
}
