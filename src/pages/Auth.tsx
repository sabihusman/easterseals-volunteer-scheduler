import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Leaf, Mail, Lock, User, Phone } from "lucide-react";
import { z } from "zod";
import { sendEmail } from "@/lib/email-utils";
import { Turnstile } from "@marsidev/react-turnstile";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Full name is required").max(100, "Name must be under 100 characters"),
  email: z.string().trim().email("Invalid email address").max(255, "Email must be under 255 characters"),
  username: z.string().trim()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be under 30 characters")
    .regex(/^[A-Za-z0-9_]+$/, "Only letters, numbers, and underscores allowed"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[a-zA-Z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export default function Auth() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { inactivitySignout?: boolean; accountDeleted?: boolean } | null;

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [regErrors, setRegErrors] = useState<Record<string, string>>({});

  const [resetEmail, setResetEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      toast({ title: "Verification required", description: "Please complete the security check.", variant: "destructive" });
      return;
    }
    setLoading(true);

    // Resolve identifier: if it contains @, use as email; otherwise look up email by username
    let emailToUse = loginIdentifier.trim();
    if (!emailToUse.includes("@")) {
      const { data: resolvedEmail } = await supabase
        .rpc("get_email_by_username", { p_username: emailToUse });
      if (!resolvedEmail) {
        // Generic error to avoid username enumeration / email oracle
        setLoading(false);
        setTurnstileToken(null);
        toast({ title: "Login failed", description: "Invalid credentials.", variant: "destructive" });
        return;
      }
      emailToUse = resolvedEmail as string;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: loginPassword,
      options: { captchaToken: turnstileToken },
    });
    setTurnstileToken(null);
    if (error) {
      setLoading(false);
      toast({ title: "Login failed", description: "Invalid credentials.", variant: "destructive" });
      return;
    }

    // Use the official MFA AAL check — the previous session.user.factors approach was wrong
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setLoading(false);
    if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      navigate("/mfa-verify");
    } else {
      navigate("/");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = registerSchema.safeParse({ name: regName, email: regEmail, username: regUsername, password: regPassword });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => { fieldErrors[err.path[0] as string] = err.message; });
      setRegErrors(fieldErrors);
      return;
    }
    setRegErrors({});

    // Check username availability
    const { data: available } = await supabase.rpc("username_available", { p_username: result.data.username });
    if (!available) {
      setRegErrors({ username: "Username is already taken" });
      return;
    }
    if (!tosAccepted) {
      toast({ title: "Terms required", description: "Please accept the Terms of Service and Code of Conduct.", variant: "destructive" });
      return;
    }
    if (!turnstileToken) {
      toast({ title: "Verification required", description: "Please complete the security check.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: result.data.email,
      password: result.data.password,
      options: { emailRedirectTo: window.location.origin, captchaToken: turnstileToken },
    });
    setTurnstileToken(null);
    if (error) {
      setLoading(false);
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
      return;
    }
    if (data.user) {
      // Create the profile row. Previously the result was ignored, so
      // an RLS/network failure here would leave the auth user orphaned
      // without a profile row — the rest of the app would then fail
      // to resolve their role on first login.
      const { error: profileError } = await supabase.from("profiles").insert({
        id: data.user.id,
        email: result.data.email,
        username: result.data.username,
        full_name: result.data.name,
        phone: regPhone || null,
        role: "volunteer",
        is_active: false,
        onboarding_complete: false,
        tos_accepted_at: new Date().toISOString(),
      });
      if (profileError) {
        setLoading(false);
        toast({
          title: "Account partially created",
          description:
            "Your login was created but we couldn't finish setting up your profile. Please contact an administrator before signing in: " +
            profileError.message,
          variant: "destructive",
        });
        return;
      }
      // Fire and forget welcome email
      sendEmail({
        to: result.data.email,
        type: "registration_welcome",
        volunteerName: result.data.name,
      }).catch(console.error);
    }
    setLoading(false);
    toast({ title: "Account created", description: "Please check your email to verify your account." });
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      toast({ title: "Verification required", description: "Please complete the security check.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken: turnstileToken,
    });
    setTurnstileToken(null);
    setLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "Password reset link sent." });
      setShowReset(false);
    }
  };

  const handleOAuth = async (provider: "google") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
  };

  if (showReset) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
              <Leaf className="h-6 w-6 text-primary-foreground" />
            </div>
            <CardTitle>Reset Password</CardTitle>
            <CardDescription>Enter your email to receive a reset link.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="reset-email" type="email" className="pl-10" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required />
                </div>
              </div>
              <div className="flex justify-center">
                <Turnstile
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onExpire={() => setTurnstileToken(null)}
                  options={{ theme: "light", size: "normal" }}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !turnstileToken}>
                {loading ? "Sending..." : !turnstileToken ? "Verifying..." : "Send Reset Link"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setShowReset(false)}>
                Back to Login
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        {locationState?.inactivitySignout && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 text-center">
            You were signed out due to inactivity.
          </div>
        )}
        {locationState?.accountDeleted && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground text-center">
            Your account has been successfully deleted.
          </div>
        )}
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
              <Leaf className="h-6 w-6 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">Easterseals Iowa</CardTitle>
            <CardDescription>Sign in to manage your volunteer shifts</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "register")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-identifier">Email or Username</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="login-identifier"
                        type="text"
                        autoComplete="username"
                        className="pl-10"
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="login-password" type="password" className="pl-10" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <Turnstile
                      siteKey={TURNSTILE_SITE_KEY}
                      onSuccess={(token) => setTurnstileToken(token)}
                      onExpire={() => setTurnstileToken(null)}
                      options={{ theme: "light", size: "normal" }}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading || !turnstileToken}>
                    {loading ? "Signing in..." : !turnstileToken ? "Verifying..." : "Sign In"}
                  </Button>
                  <div className="text-center">
                    <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                      Forgot your password?
                    </Link>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="reg-name" className="pl-10" value={regName} onChange={(e) => setRegName(e.target.value)} required maxLength={100} />
                    </div>
                    {regErrors.name && <p className="text-xs text-destructive">{regErrors.name}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="reg-email" type="email" className="pl-10" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required maxLength={255} />
                    </div>
                    {regErrors.email && <p className="text-xs text-destructive">{regErrors.email}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-username">Username</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-username"
                        className="pl-10"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        required
                        maxLength={30}
                        placeholder="e.g. jane_doe"
                      />
                    </div>
                    {regErrors.username && <p className="text-xs text-destructive">{regErrors.username}</p>}
                    <p className="text-xs text-muted-foreground">3-30 characters, letters, numbers, and underscores only</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-phone">Phone (optional)</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="reg-phone" type="tel" className="pl-10" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="reg-password" type="password" className="pl-10" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required />
                    </div>
                    {regErrors.password && <p className="text-xs text-destructive">{regErrors.password}</p>}
                    <p className="text-xs text-muted-foreground">Min 8 chars, must include a letter and a number</p>
                  </div>
                  <div className="flex items-start space-x-2">
                    <Checkbox
                      id="tos"
                      checked={tosAccepted}
                      onCheckedChange={(checked) => setTosAccepted(checked === true)}
                      className="mt-1"
                    />
                    <Label htmlFor="tos" className="text-sm leading-5 cursor-pointer">
                      I agree to the Terms of Service and Code of Conduct
                    </Label>
                  </div>
                  <div className="flex justify-center">
                    <Turnstile
                      siteKey={TURNSTILE_SITE_KEY}
                      onSuccess={(token) => setTurnstileToken(token)}
                      onExpire={() => setTurnstileToken(null)}
                      options={{ theme: "light", size: "normal" }}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading || !tosAccepted || !turnstileToken}>
                    {loading ? "Creating account..." : !turnstileToken ? "Verifying..." : "Create Account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Or continue with</span></div>
              </div>
              <div className="mt-4">
                <Button variant="outline" onClick={() => handleOAuth("google")} type="button" className="w-full">
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  Sign in with Google
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center mt-3">More sign-in options coming soon</p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
