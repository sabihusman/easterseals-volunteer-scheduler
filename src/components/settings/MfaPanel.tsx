import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BackupCodesDialog } from "./BackupCodesDialog";

/**
 * Two-factor authentication panel. Owns:
 *   - enrolled/factor state, fetched from `supabase.auth.mfa.listFactors()`
 *   - enrollment flow (enroll → challenge → verify → generate backup codes)
 *   - backup-code regeneration
 *   - removal (unenroll)
 *
 * Renders the BackupCodesDialog as a child driven by local `codes` state.
 */
export function MfaPanel() {
  const { toast } = useToast();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [enrollFactorId, setEnrollFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [unusedBackupCount, setUnusedBackupCount] = useState<number | null>(null);

  useEffect(() => {
    const checkMfa = async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (data?.totp && data.totp.length > 0) {
        const verified = data.totp.find((f) => f.status === "verified");
        if (verified) {
          setEnrolled(true);
          setFactorId(verified.id);
        }
      }
    };
    checkMfa();
  }, []);

  // When MFA is enrolled, fetch how many backup codes the user has left.
  useEffect(() => {
    if (!enrolled) { setUnusedBackupCount(null); return; }
    (async () => {
      const { data, error } = await (supabase as any).rpc("mfa_unused_backup_code_count");
      if (!error && typeof data === "number") setUnusedBackupCount(data);
    })();
  }, [enrolled]);

  const handleEnable = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    if (data) {
      setQrCode(data.totp.qr_code);
      setEnrollFactorId(data.id);
      setEnrollDialogOpen(true);
    }
  };

  const handleVerifyEnrollment = async () => {
    if (!enrollFactorId || code.length !== 6) return;
    setLoading(true);
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrollFactorId });
    if (challengeError) {
      setLoading(false);
      toast({ title: "Error", description: challengeError.message, variant: "destructive" });
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollFactorId,
      challengeId: challengeData.id,
      code,
    });
    setLoading(false);
    if (verifyError) {
      toast({ title: "Verification failed", description: verifyError.message, variant: "destructive" });
      setCode("");
      return;
    }
    setEnrolled(true);
    setFactorId(enrollFactorId);
    setEnrollDialogOpen(false);
    setQrCode(null);
    setCode("");

    // Generate backup recovery codes and show them ONCE. Without these, a
    // user who loses their authenticator is locked out until an admin resets MFA.
    const { data: codes, error: codesError } = await (supabase as any).rpc("mfa_generate_backup_codes");
    if (codesError) {
      toast({
        title: "2FA enabled, but backup codes failed",
        description: "Generate backup codes manually from this page or you may be locked out if you lose your device.",
        variant: "destructive",
      });
    } else if (Array.isArray(codes)) {
      setBackupCodes(codes);
      setUnusedBackupCount(codes.length);
    }
    toast({ title: "2FA enabled", description: "Two-factor authentication is now active on your account." });
  };

  const handleRegenerateBackupCodes = async () => {
    setLoading(true);
    const { data: codes, error } = await (supabase as any).rpc("mfa_generate_backup_codes");
    setLoading(false);
    if (error) {
      toast({ title: "Could not generate codes", description: error.message, variant: "destructive" });
      return;
    }
    if (Array.isArray(codes)) {
      setBackupCodes(codes);
      setUnusedBackupCount(codes.length);
      toast({ title: "New backup codes generated", description: "Previous codes are now invalid." });
    }
  };

  const handleRemove = async () => {
    if (!factorId) return;
    setLoading(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setEnrolled(false);
    setFactorId(null);
    toast({ title: "2FA removed", description: "Two-factor authentication has been disabled." });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Two-Factor Authentication</CardTitle>
          <CardDescription>Add an extra layer of security to your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {enrolled ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
                  <p className="text-sm text-muted-foreground">2FA is enabled on your account</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleRemove} disabled={loading}>
                  {loading ? "Removing..." : "Remove 2FA"}
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-md border border-dashed p-3">
                <div>
                  <p className="text-sm font-medium">Backup recovery codes</p>
                  <p className="text-xs text-muted-foreground">
                    {unusedBackupCount === null
                      ? "Loading…"
                      : unusedBackupCount === 0
                        ? "No codes remaining. Generate new ones to avoid getting locked out."
                        : `${unusedBackupCount} of 10 codes remaining`}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleRegenerateBackupCodes} disabled={loading}>
                  {loading ? "Generating…" : "Generate new codes"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Protect your account with a TOTP authenticator app</p>
              <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" onClick={handleEnable} disabled={loading}>
                    {loading ? "Setting up..." : "Enable 2FA"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
                    <DialogDescription>Scan the QR code with your authenticator app, then enter the 6-digit code.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    {qrCode && (
                      <div className="flex justify-center">
                        <img src={qrCode} alt="MFA QR Code" className="w-48 h-48" />
                      </div>
                    )}
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="text-center text-xl tracking-widest"
                    />
                    <Button className="w-full" onClick={handleVerifyEnrollment} disabled={loading || code.length !== 6}>
                      {loading ? "Verifying..." : "Verify & Enable"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>

      <BackupCodesDialog codes={backupCodes} onClose={() => setBackupCodes(null)} />
    </>
  );
}
