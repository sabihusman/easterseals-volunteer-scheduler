import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User as UserIcon, Loader2, LogIn } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";
import { useToast } from "@/hooks/use-toast";
import { resolveLoginIdentifierToEmail } from "@/lib/checkin-actions";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

interface Props {
  /** Called after successful sign-in with the resolved Supabase user. */
  onLoginSuccess: (user: User) => void;
}

/**
 * Login card for the CheckIn flow. Owns its own form state, Turnstile
 * token, and the full login sequence:
 *
 *   1. Resolve username → email (if no `@`) via RPC
 *   2. signInWithPassword with the captcha token
 *   3. Check MFA assurance level — if step-up is required, refuse and
 *      direct the user to the main site (no MFA verification UI here)
 *
 * The MFA gate stays here because it's the second half of the auth
 * transaction; splitting it across files would change the unit.
 */
export function LoginForm({ onLoginSuccess }: Props) {
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!turnstileToken) {
      toast({ title: "Verification required", description: "Please complete the security check.", variant: "destructive" });
      return;
    }
    setLoading(true);

    // Resolve identifier (email vs username)
    let emailToUse = identifier.trim();
    if (!emailToUse.includes("@")) {
      const resolved = await resolveLoginIdentifierToEmail(emailToUse);
      if (!resolved) {
        setLoading(false);
        setTurnstileToken(null);
        toast({ title: "Login failed", description: "Invalid credentials.", variant: "destructive" });
        return;
      }
      emailToUse = resolved;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password,
      options: { captchaToken: turnstileToken },
    });
    setTurnstileToken(null);

    if (error) {
      setLoading(false);
      toast({ title: "Login failed", description: "Invalid credentials.", variant: "destructive" });
      return;
    }

    // MFA gate — if step-up is required, push the user back to the main
    // site rather than handling MFA verification here.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      setLoading(false);
      toast({
        title: "MFA Required",
        description: "Please complete MFA verification on the main site first, then scan the QR code again.",
        variant: "destructive",
      });
      return;
    }

    setLoading(false);
    if (data.session?.user) {
      onLoginSuccess(data.session.user);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <LogIn className="h-5 w-5" /> Sign In to Check In
        </CardTitle>
        <CardDescription>
          Enter your credentials to check in for your shift.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="checkin-identifier">Email or Username</Label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="checkin-identifier"
                type="text"
                autoComplete="username"
                className="pl-10"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="checkin-password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="checkin-password"
                type="password"
                autoComplete="current-password"
                className="pl-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex justify-center">
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              onSuccess={(t) => setTurnstileToken(t)}
              onExpire={() => setTurnstileToken(null)}
              options={{ theme: "light", size: "normal" }}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !turnstileToken}>
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Signing in...</>
            ) : !turnstileToken ? (
              "Verifying..."
            ) : (
              "Sign In & Check In"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
