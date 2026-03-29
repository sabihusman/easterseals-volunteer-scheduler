import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Leaf, Mail, Lock, User, Phone, Shield, Users, UserCheck } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export default function Auth() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);

  const [resetEmail, setResetEmail] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } else {
      navigate("/");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim()) {
      toast({ title: "Name required", description: "Please enter your full name.", variant: "destructive" });
      return;
    }
    if (!tosAccepted) {
      toast({ title: "Terms required", description: "Please accept the Terms of Service and Code of Conduct.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: regEmail,
      password: regPassword,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setLoading(false);
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
      return;
    }
    if (data.user) {
      await supabase.from("profiles").insert({
        id: data.user.id,
        email: regEmail,
        full_name: regName,
        phone: regPhone || null,
        role: "volunteer",
        is_active: false,
        onboarding_complete: false,
        tos_accepted_at: new Date().toISOString(),
      });
    }
    setLoading(false);
    toast({ title: "Account created", description: "Please check your email to verify your account." });
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
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

  const fillDemo = (email: string, password: string) => {
    setLoginEmail(email);
    setLoginPassword(password);
    setTab("login");
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending..." : "Send Reset Link"}
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
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
              <Leaf className="h-6 w-6 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">Easterseals Volunteer Scheduler</CardTitle>
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
                    <Label htmlFor="login-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="login-email" type="email" className="pl-10" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="login-password" type="password" className="pl-10" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                  <Button type="button" variant="link" className="w-full text-sm" onClick={() => setShowReset(true)}>
                    Forgot password?
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="reg-name" className="pl-10" value={regName} onChange={(e) => setRegName(e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input id="reg-email" type="email" className="pl-10" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required />
                    </div>
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
                      <Input id="reg-password" type="password" className="pl-10" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required minLength={6} />
                    </div>
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
                  <Button type="submit" className="w-full" disabled={loading || !tosAccepted}>
                    {loading ? "Creating account..." : "Create Account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Or continue with</span></div>
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

        {/* Demo Login Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Demo Accounts</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex flex-col items-center gap-1 h-auto py-2"
              onClick={() => fillDemo("sabih.usman@gmail.com", "Demo1234!")}
            >
              <Shield className="h-4 w-4 text-destructive" />
              <span className="text-xs">Admin</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex flex-col items-center gap-1 h-auto py-2"
              onClick={() => fillDemo("coordinator@demo.com", "Demo1234!")}
            >
              <UserCheck className="h-4 w-4 text-primary" />
              <span className="text-xs">Coordinator</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex flex-col items-center gap-1 h-auto py-2"
              onClick={() => fillDemo("volunteer@demo.com", "Demo1234!")}
            >
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs">Volunteer</span>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
