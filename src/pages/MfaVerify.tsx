import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Shield, Leaf } from "lucide-react";

export default function MfaVerify() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const checkAssuranceLevel = async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        navigate("/auth");
        return;
      }
      // If already at aal2, go to dashboard
      if (data.currentLevel === "aal2") {
        navigate("/dashboard");
        return;
      }
      // If no next level requiring aal2, go to dashboard
      if (data.nextLevel !== "aal2") {
        navigate("/dashboard");
        return;
      }
      // Get the verified TOTP factor
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      if (factorsData?.totp && factorsData.totp.length > 0) {
        const verifiedFactor = factorsData.totp.find((f) => f.status === "verified");
        if (verifiedFactor) {
          setFactorId(verifiedFactor.id);
        } else {
          toast({ title: "Error", description: "No verified MFA factor found.", variant: "destructive" });
          navigate("/auth");
        }
      } else {
        navigate("/dashboard");
      }
    };
    checkAssuranceLevel();
  }, [navigate, toast]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || code.length !== 6) return;
    setLoading(true);
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setLoading(false);
      toast({ title: "Error", description: challengeError.message, variant: "destructive" });
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });
    setLoading(false);
    if (verifyError) {
      toast({ title: "Verification failed", description: verifyError.message, variant: "destructive" });
      setCode("");
    } else {
      navigate("/dashboard");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
            <Leaf className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="flex items-center justify-center gap-2">
            <Shield className="h-5 w-5" /> Two-Factor Authentication
          </CardTitle>
          <CardDescription>Enter the 6-digit code from your authenticator app</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center text-2xl tracking-widest"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
              {loading ? "Verifying..." : "Verify"}
            </Button>
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-primary hover:underline"
                onClick={() =>
                  toast({
                    title: "Recovery codes",
                    description: "Contact your admin to reset MFA.",
                  })
                }
              >
                Use recovery code
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
