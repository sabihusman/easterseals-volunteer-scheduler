import { useState, useEffect, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
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
import { QrCode, Download, RefreshCw, Loader2, Copy, Printer, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface CheckinToken {
  id: string;
  token: string;
  is_active: boolean;
  rotation_mode: string;
  created_at: string;
  expires_at: string | null;
}

export function AdminQRCheckIn() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<CheckinToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [rotationMode, setRotationMode] = useState<string>("none");
  const [deleteTarget, setDeleteTarget] = useState<CheckinToken | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  const fetchTokens = useCallback(async () => {
    const { data } = await supabase
      .from("checkin_tokens")
      .select("*")
      .order("created_at", { ascending: false });
    setTokens((data as CheckinToken[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const activeToken = tokens.find((t) => t.is_active);

  const getCheckinUrl = (token: string) => {
    return `${window.location.origin}/checkin?token=${token}`;
  };

  const handleCreate = async () => {
    setCreating(true);
    const newToken = crypto.randomUUID();
    const { error } = await supabase.from("checkin_tokens").insert({
      token: newToken,
      is_active: true,
      rotation_mode: rotationMode,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "QR code created", description: "A new check-in QR code has been generated." });
      await fetchTokens();
    }
    setCreating(false);
  };

  const handleRegenerate = async () => {
    if (!activeToken) return;
    setCreating(true);
    // Deactivate old token
    await supabase
      .from("checkin_tokens")
      .update({ is_active: false, expires_at: new Date().toISOString() })
      .eq("id", activeToken.id);
    // Create new one with same rotation mode
    const newToken = crypto.randomUUID();
    await supabase.from("checkin_tokens").insert({
      token: newToken,
      is_active: true,
      rotation_mode: activeToken.rotation_mode,
    });
    toast({ title: "QR code regenerated", description: "The old code has been deactivated." });
    await fetchTokens();
    setCreating(false);
  };

  const handleUpdateRotation = async (mode: string) => {
    if (!activeToken) return;
    await supabase
      .from("checkin_tokens")
      .update({ rotation_mode: mode })
      .eq("id", activeToken.id);
    setTokens((prev) =>
      prev.map((t) => (t.id === activeToken.id ? { ...t, rotation_mode: mode } : t))
    );
    toast({ title: "Rotation updated", description: `Token will now rotate ${mode === "none" ? "manually only" : mode}.` });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await supabase.from("checkin_tokens").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    await fetchTokens();
    toast({ title: "Token deleted" });
  };

  const handleCopyUrl = () => {
    if (!activeToken) return;
    navigator.clipboard.writeText(getCheckinUrl(activeToken.token));
    toast({ title: "Copied", description: "Check-in URL copied to clipboard." });
  };

  const handleDownloadPNG = () => {
    if (!qrRef.current) return;
    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;

    // Create high-res canvas for print (300 DPI, A4-friendly)
    const canvas = document.createElement("canvas");
    const size = 1200; // ~4 inches at 300 DPI
    canvas.width = size;
    canvas.height = size + 200; // Extra space for text
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw QR code
    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 100, 50, size - 200, size - 200);

      // Add text below QR
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 48px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Scan to Check In", size / 2, size - 60);
      ctx.font = "32px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#666666";
      ctx.fillText("Easterseals Iowa Volunteer Check-In", size / 2, size);

      // Download
      const link = document.createElement("a");
      link.download = `easterseals-checkin-qr-${format(new Date(), "yyyy-MM-dd")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const handlePrint = () => {
    if (!activeToken) return;
    const url = getCheckinUrl(activeToken.token);

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Check-In QR Code - Easterseals Iowa</title>
        <style>
          body {
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; min-height: 100vh; margin: 0;
            font-family: system-ui, -apple-system, sans-serif;
          }
          h1 { font-size: 36px; margin-bottom: 40px; color: #1a1a1a; }
          .qr-container { text-align: center; }
          p { font-size: 20px; color: #666; margin-top: 30px; }
          .url { font-size: 12px; color: #999; word-break: break-all; max-width: 500px; margin-top: 10px; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <h1>Easterseals Iowa</h1>
        <div class="qr-container" id="qr"></div>
        <p>Scan this QR code to check in for your volunteer shift</p>
        <div class="url">${url}</div>
        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
        <script>
          QRCode.toCanvas(document.createElement('canvas'), '${url}', { width: 400, margin: 2 }, function(err, canvas) {
            if (!err) document.getElementById('qr').appendChild(canvas);
            setTimeout(function() { window.print(); }, 500);
          });
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-muted-foreground">Loading QR check-in...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5" /> QR Code Check-In
              </CardTitle>
              <CardDescription>
                Print and display this QR code at the front desk. Volunteers scan it to check in.
              </CardDescription>
            </div>
            {activeToken && (
              <Badge variant="default" className="bg-green-600">Active</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeToken ? (
            <>
              {/* QR Code Display */}
              <div className="flex flex-col items-center gap-4">
                <div
                  ref={qrRef}
                  className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-6 bg-white"
                >
                  <QRCodeSVG
                    value={getCheckinUrl(activeToken.token)}
                    size={200}
                    level="H"
                    includeMargin
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center max-w-sm break-all">
                  {getCheckinUrl(activeToken.token)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={handleCopyUrl}>
                  <Copy className="h-4 w-4 mr-1" />Copy URL
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownloadPNG}>
                  <Download className="h-4 w-4 mr-1" />Download PNG
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-1" />Print
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={creating}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Regenerate
                </Button>
              </div>

              {/* Rotation settings */}
              <div className="border-t pt-4 space-y-2">
                <Label className="text-sm font-medium">Auto-Rotation</Label>
                <Select
                  value={activeToken.rotation_mode}
                  onValueChange={handleUpdateRotation}
                >
                  <SelectTrigger className="w-full sm:w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Manual only</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {activeToken.rotation_mode === "none"
                    ? "This QR code will remain active until you manually regenerate it."
                    : `This QR code will automatically rotate ${activeToken.rotation_mode}. A new code will be generated and the old one will expire.`}
                </p>
              </div>

              {/* Token info */}
              <div className="border-t pt-4 text-xs text-muted-foreground space-y-1">
                <p>Created: {format(new Date(activeToken.created_at), "MMM d, yyyy h:mm a")}</p>
                {activeToken.expires_at && (
                  <p>Expires: {format(new Date(activeToken.expires_at), "MMM d, yyyy h:mm a")}</p>
                )}
              </div>
            </>
          ) : (
            /* No active token — create one */
            <div className="text-center space-y-4 py-4">
              <QrCode className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">No active check-in QR code. Create one to get started.</p>
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Rotation:</Label>
                  <Select value={rotationMode} onValueChange={setRotationMode}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Manual only</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</>
                  ) : (
                    <><QrCode className="h-4 w-4 mr-2" />Generate QR Code</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Expired tokens history */}
          {tokens.filter((t) => !t.is_active).length > 0 && (
            <div className="border-t pt-4 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Previous Tokens</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {tokens
                  .filter((t) => !t.is_active)
                  .slice(0, 5)
                  .map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between text-xs text-muted-foreground py-1"
                    >
                      <span>
                        {t.token.slice(0, 8)}... | Expired{" "}
                        {t.expires_at
                          ? format(new Date(t.expires_at), "MMM d, h:mm a")
                          : "manually"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(t)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Token?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this expired token from the history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
