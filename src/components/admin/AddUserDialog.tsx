import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generatePassword, validateAddUser } from "@/lib/admin-user-utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of admins currently in the system; used to enforce the 2-admin cap. */
  adminCount: number;
  /** Called after successful create + close so the parent can refresh the profiles list. */
  onUserCreated: () => void;
}

interface CreatedCreds {
  email: string;
  password: string;
}

/**
 * Two-pane Add User dialog. Self-contained:
 *   - Owns form state, validation errors, saving flag, and the post-create
 *     credentials view.
 *   - Calls supabase.auth.signUp + profiles.insert internally.
 *   - On success swaps the form for a credentials display; on close calls
 *     onUserCreated() so the parent can refresh.
 *
 * Page just controls open/close + provides adminCount for the 2-admin cap.
 */
export function AddUserDialog({ open, onOpenChange, adminCount, onUserCreated }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"coordinator" | "admin">("coordinator");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<CreatedCreds | null>(null);

  function reset() {
    setName("");
    setEmail("");
    setRole("coordinator");
    setNameError("");
    setEmailError("");
    setCreatedCreds(null);
  }

  function close() {
    if (createdCreds) onUserCreated();
    reset();
    onOpenChange(false);
  }

  async function handleCreate() {
    const result = validateAddUser(name, email);
    setNameError(result.nameError);
    setEmailError(result.emailError);
    if (!result.valid) return;

    if (role === "admin" && adminCount >= 2) {
      toast({ title: "Admin limit reached", description: "Maximum of 2 admins allowed.", variant: "destructive" });
      return;
    }

    setCreating(true);
    const password = generatePassword();

    // signUp from the client because we don't have service_role here. Auto-
    // confirms if Supabase is configured for it; otherwise the user gets a
    // confirmation email. Pre-existing UX choice.
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });

    if (authError || !authData.user) {
      setCreating(false);
      toast({
        title: "Error creating user",
        description: authError?.message || "Unknown error",
        variant: "destructive",
      });
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: authData.user.id,
      email: email.trim(),
      full_name: name.trim(),
      role,
      is_active: true,
    });

    setCreating(false);

    if (profileError) {
      toast({
        title: "User created but profile insert failed",
        description: profileError.message,
        variant: "destructive",
      });
      return;
    }

    setCreatedCreds({ email: email.trim(), password });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
          <DialogDescription>Create a coordinator or admin account. Volunteers self-register.</DialogDescription>
        </DialogHeader>

        {createdCreds ? (
          <div className="space-y-4">
            <div className="p-4 rounded-md bg-success/10 border border-success/30 space-y-2">
              <p className="text-sm font-medium text-foreground">User created successfully!</p>
              <p className="text-sm text-muted-foreground">Share these credentials securely with the new user.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Email</Label>
              <div className="flex gap-2">
                <Input value={createdCreds.email} readOnly className="text-sm" />
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(createdCreds.email); toast({ title: "Copied!" }); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Password</Label>
              <div className="flex gap-2">
                <Input value={createdCreds.password} readOnly className="text-sm font-mono" />
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(createdCreds.password); toast({ title: "Copied!" }); }}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs font-bold">Full Name</Label>
              <Input value={name} onChange={(e) => { setName(e.target.value); setNameError(""); }} placeholder="Jane Smith" maxLength={100} />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">Email</Label>
              <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailError(""); }} placeholder="jane@example.com" maxLength={255} />
              {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "coordinator" | "admin")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coordinator">Coordinator</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {role === "admin" && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <p className="text-xs text-foreground">Admins have full access to all data. There can only be 2 admins at any time.</p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
