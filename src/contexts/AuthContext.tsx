import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Sentry } from "@/lib/sentry";

type UserRole = Database["public"]["Enums"]["user_role"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    setProfile(data);
    if (data) {
      // Tag every Sentry event with the signed-in user's id/email/role
      // so errors can be filtered by who experienced them.
      Sentry.setUser({
        id: data.id,
        email: data.email ?? undefined,
        role: data.role ?? undefined,
      });
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    // IMPORTANT: Do NOT await any supabase calls inside onAuthStateChange —
    // the callback runs while holding the GoTrue auth lock, and awaiting
    // a supabase query inside it will deadlock the lock and hang the app.
    // Defer the profile fetch with setTimeout(..., 0) as recommended by
    // Supabase docs.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => { fetchProfile(session.user.id); }, 0);

          // Increment signin_count on actual sign-in (not token
          // refresh). Drives the onboarding modal: show on the first
          // 3 sign-ins if onboarding isn't complete. Best-effort
          // read-then-write — if it fails the counter just stays the
          // same. Low stakes.
          if (event === "SIGNED_IN") {
            const uid = session.user.id;
            setTimeout(async () => {
              const { data } = await supabase
                .from("profiles")
                .select("signin_count")
                .eq("id", uid)
                .single();
              const current = (data as { signin_count?: number } | null)?.signin_count ?? 0;
              await supabase
                .from("profiles")
                .update({ signin_count: current + 1 } as never)
                .eq("id", uid);
            }, 0);
          }
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    Sentry.setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        role: profile?.role ?? null,
        loading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
