import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Props {
  /** When non-null, dialog is open. Set to null to close. */
  codes: string[] | null;
  onClose: () => void;
}

/**
 * One-time backup-codes display modal. Cannot be dismissed without the user
 * acknowledging they've saved the codes (preserves the safety guard from the
 * original page). Provides a clipboard-copy helper.
 */
export function BackupCodesDialog({ codes, onClose }: Props) {
  const { toast } = useToast();
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset acknowledgement whenever a fresh batch of codes arrives.
  useEffect(() => {
    if (codes) setAcknowledged(false);
  }, [codes]);

  const handleCopy = async () => {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast({ title: "Copied", description: "Backup codes copied to clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the codes manually and copy them.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={codes !== null}
      onOpenChange={(open) => {
        // Block closing until the user confirms they've saved the codes
        if (!open && !acknowledged) return;
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save Your Backup Recovery Codes</DialogTitle>
          <DialogDescription>
            Store these codes somewhere safe. Each code can be used once if you
            lose access to your authenticator app. You will not see them again.
          </DialogDescription>
        </DialogHeader>
        {codes && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-4 font-mono text-sm">
              {codes.map((code) => (
                <div key={code} className="text-center select-all">{code}</div>
              ))}
            </div>
            <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Important:</strong> If you lose your authenticator <em>and</em> these codes,
              you will need an admin to reset your 2FA. Save them now in a password manager,
              print them, or store them in a secure location.
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="backup-ack"
                checked={acknowledged}
                onCheckedChange={(c: boolean | "indeterminate") => setAcknowledged(c === true)}
              />
              <Label htmlFor="backup-ack" className="text-sm font-normal cursor-pointer">
                I have saved these codes in a safe place
              </Label>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                Copy to clipboard
              </Button>
              <Button
                className="flex-1"
                disabled={!acknowledged}
                onClick={onClose}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
