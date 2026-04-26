import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AtSign, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unchanged";

interface Props {
  userId: string;
  /** Current username from profile (null if never set). */
  initialUsername: string | null;
  /** Called after a successful save so the parent can refreshProfile(). */
  onSaved: () => Promise<void> | void;
}

/**
 * Username panel. Owns:
 *   - the input field
 *   - a 400 ms debounced availability check via the `username_available` RPC
 *   - the save action with 23505-unique-violation handling
 *
 * Profile re-renders propagate `initialUsername` changes back to local state.
 */
export function UsernamePanel({ userId, initialUsername, onSaved }: Props) {
  const { toast } = useToast();
  const [currentUsername, setCurrentUsername] = useState<string | null>(initialUsername);
  const [usernameInput, setUsernameInput] = useState(initialUsername ?? "");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>(initialUsername ? "unchanged" : "idle");
  const [usernameSaving, setUsernameSaving] = useState(false);

  // Sync local state if the parent sends a fresh initialUsername (e.g. after refresh).
  useEffect(() => {
    setCurrentUsername(initialUsername);
    setUsernameInput(initialUsername ?? "");
    setUsernameStatus(initialUsername ? "unchanged" : "idle");
  }, [initialUsername]);

  // Debounced availability probe.
  useEffect(() => {
    const trimmed = usernameInput.trim();
    if (!trimmed) { setUsernameStatus("idle"); return; }
    if (trimmed === (currentUsername ?? "")) { setUsernameStatus("unchanged"); return; }
    if (!/^[A-Za-z0-9_]{3,30}$/.test(trimmed)) { setUsernameStatus("invalid"); return; }

    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      const { data: available } = await (supabase as any).rpc("username_available", { p_username: trimmed });
      setUsernameStatus(available ? "available" : "taken");
    }, 400);
    return () => clearTimeout(timer);
  }, [usernameInput, currentUsername]);

  const handleSaveUsername = async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed || usernameStatus !== "available") return;
    setUsernameSaving(true);
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ username: trimmed, updated_at: new Date().toISOString() })
      .eq("id", userId);
    setUsernameSaving(false);
    if (error) {
      // Unique violation — someone grabbed it between check and save.
      if ((error as any).code === "23505") {
        setUsernameStatus("taken");
        toast({ title: "Username taken", description: "Please choose a different username.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
      return;
    }
    setCurrentUsername(trimmed);
    setUsernameStatus("unchanged");
    toast({ title: "Username updated", description: `You can now sign in with @${trimmed}.` });
    await onSaved();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><AtSign className="h-4 w-4" /> Username</CardTitle>
        <CardDescription>
          Pick a unique username you can use to sign in instead of your email. 3-30 characters, letters, numbers, and underscores only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentUsername && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            Current username: <strong>@{currentUsername}</strong>
          </div>
        )}
        <div className="space-y-2">
          <Label>Username</Label>
          <div className="relative">
            <AtSign className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="e.g. jane_doe"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              maxLength={30}
              autoComplete="off"
            />
          </div>
          {usernameStatus === "checking" && (
            <p className="text-xs text-muted-foreground">Checking availability...</p>
          )}
          {usernameStatus === "available" && (
            <p className="text-xs text-primary flex items-center gap-1">
              <Check className="h-3 w-3" /> Available
            </p>
          )}
          {usernameStatus === "taken" && (
            <p className="text-xs text-destructive">That username is already taken.</p>
          )}
          {usernameStatus === "invalid" && (
            <p className="text-xs text-destructive">Use 3-30 letters, numbers, or underscores.</p>
          )}
          {usernameStatus === "unchanged" && currentUsername && (
            <p className="text-xs text-muted-foreground">This is your current username.</p>
          )}
        </div>
        <Button onClick={handleSaveUsername} disabled={usernameSaving || usernameStatus !== "available"}>
          {usernameSaving ? "Saving..." : currentUsername ? "Update Username" : "Set Username"}
        </Button>
      </CardContent>
    </Card>
  );
}
