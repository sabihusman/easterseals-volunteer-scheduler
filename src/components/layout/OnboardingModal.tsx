import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  User,
  Building2,
  CalendarSearch,
  CheckCircle2,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProfileForm {
  full_name: string;
  phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
}

interface Department {
  id: string;
  name: string;
  description: string | null;
}

const TOTAL_STEPS = 5; // 0-indexed: 0..4

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/* Step indicator dot */
function StepDot({ active, complete }: { active: boolean; complete: boolean }) {
  return (
    <div
      className={[
        "h-2 w-2 rounded-full transition-all",
        active
          ? "w-6 bg-primary"
          : complete
          ? "bg-primary/40"
          : "bg-muted",
      ].join(" ")}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OnboardingModal() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);

  // Step 2: profile
  const [form, setForm] = useState<ProfileForm>({
    full_name: "",
    phone: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
  });

  // Step 3: departments
  const [departments, setDepartments] = useState<Department[]>([]);

  /* ---------- Init — check onboarding status ---------- */

  const init = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_complete, signin_count, full_name, phone, emergency_contact_name, emergency_contact_phone, role")
      .eq("id", user.id)
      .single();

    // Skip onboarding for admins and coordinators
    if (profile && (profile.role === "admin" || profile.role === "coordinator")) return;

    // Show the modal if the user hasn't completed onboarding AND
    // they've signed in 3 or fewer times. After 3 sign-ins, stop
    // showing it automatically — the user can still open it from
    // the dashboard checklist if they want to finish later.
    const signinCount = (profile as { signin_count?: number } | null)?.signin_count ?? 0;
    const shouldShow = profile && !profile.onboarding_complete && signinCount <= 3;

    if (shouldShow) {
      setForm({
        full_name: profile.full_name ?? "",
        phone: profile.phone ?? "",
        emergency_contact_name: profile.emergency_contact_name ?? "",
        emergency_contact_phone: profile.emergency_contact_phone ?? "",
      });
      setOpen(true);

      // Pre-fetch departments for step 3
      const { data: depts } = await supabase
        .from("departments")
        .select("id, name, description")
        .eq("is_active", true)
        .order("name");

      if (depts) setDepartments(depts as Department[]);
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  /* ---------- Navigation ---------- */

  function next() {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
  }

  function prev() {
    if (step > 0) setStep((s) => s - 1);
  }

  /**
   * Dismiss the modal. If "do not show again" is checked, persist
   * onboarding_complete = true in the DB so the modal never returns.
   * Otherwise the dismissal is session-only and the modal will
   * reappear on the next page load.
   */
  async function dismiss() {
    if (doNotShowAgain && userId) {
      await supabase
        .from("profiles")
        .update({ onboarding_complete: true })
        .eq("id", userId);
    }
    setOpen(false);
  }

  /* ---------- Save profile (step 2 → 3) ---------- */

  async function saveProfile() {
    if (!userId) return;
    if (!form.full_name.trim()) {
      toast({ variant: "destructive", title: "Full name is required." });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        emergency_contact_name: form.emergency_contact_name.trim() || null,
        emergency_contact_phone: form.emergency_contact_phone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    setSaving(false);

    if (error) {
      toast({ variant: "destructive", title: "Save failed", description: error.message });
    } else {
      next();
    }
  }

  /* ---------- Complete onboarding ---------- */

  async function completeOnboarding() {
    if (!userId) return;
    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_complete: true })
      .eq("id", userId);

    setSaving(false);

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } else {
      setOpen(false);
      toast({ title: "Welcome aboard!", description: "You're all set." });
    }
  }

  /* ---------- Render steps ---------- */

  function renderStep() {
    switch (step) {
      /* ---- Step 0: Welcome ---- */
      case 0:
        return (
          <div className="flex flex-col items-center text-center py-6 px-2">
            {/* Logo placeholder — replace src with your actual logo path */}
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary">
              <Sparkles className="h-10 w-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              Welcome to the Volunteer Portal
            </h2>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Thanks for joining Easterseals Iowa! Let's get you set up in a
              few quick steps so you can start browsing and signing up for
              volunteer shifts.
            </p>
          </div>
        );

      /* ---- Step 1: Profile ---- */
      case 1:
        return (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-primary">
              <User className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Complete Your Profile</h3>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ob_name">
                Full Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="ob_name"
                value={form.full_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, full_name: e.target.value }))
                }
                placeholder="Jane Doe"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ob_phone">Phone</Label>
              <Input
                id="ob_phone"
                type="tel"
                inputMode="numeric"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))
                }
                placeholder="515-555-0199"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ob_ec_name">Emergency Contact Name</Label>
              <Input
                id="ob_ec_name"
                value={form.emergency_contact_name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    emergency_contact_name: e.target.value,
                  }))
                }
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ob_ec_phone">Emergency Contact Phone</Label>
              <Input
                id="ob_ec_phone"
                type="tel"
                inputMode="numeric"
                value={form.emergency_contact_phone}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    emergency_contact_phone: formatPhone(e.target.value),
                  }))
                }
                placeholder="515-555-0100"
              />
            </div>
          </div>
        );

      /* ---- Step 2: Departments ---- */
      case 2:
        return (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-primary">
              <Building2 className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Our Departments</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Here are the departments you can volunteer with. Each has
              different activities and requirements.
            </p>

            {departments.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground/60">
                No departments found.
              </p>
            ) : (
              <ul className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {departments.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-lg border p-3 transition-colors hover:border-primary/30"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {d.name}
                    </p>
                    {d.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {d.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );

      /* ---- Step 3: Browse shifts ---- */
      case 3:
        return (
          <div className="flex flex-col items-center text-center py-6 px-2">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CalendarSearch className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Browse Your First Shift
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              You're almost done! After completing onboarding, head over to the
              Browse Shifts page to find an opportunity that fits your schedule.
            </p>
            <Button
              variant="outline"
              className="mt-4 border-primary text-primary hover:bg-primary/5"
              onClick={() => {
                setOpen(false);
                navigate("/shifts");
              }}
            >
              Browse Shifts Now
            </Button>
          </div>
        );

      /* ---- Step 4: Done ---- */
      case 4:
        return (
          <div className="flex flex-col items-center text-center py-6 px-2">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              You're All Set!
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Your profile is complete. Click <strong>Finish</strong> to dismiss
              this guide and start volunteering.
            </p>
          </div>
        );

      default:
        return null;
    }
  }

  /* ---------- Main render ---------- */

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-md gap-0 p-0">
        {/* Accessible title (visually hidden if the step renders its own heading) */}
        <DialogTitle className="sr-only">Getting Started</DialogTitle>

        {/* Close / skip button (top-right) */}
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 z-10"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Step content */}
        <div className="px-6 pt-6 pb-2">{renderStep()}</div>

        {/* Footer: dots + "do not show again" + nav */}
        <div className="border-t px-6 py-4 space-y-3">
          {/* Row 1: step dots + nav buttons */}
          <div className="flex items-center justify-between">
            {/* Dots */}
            <div className="flex items-center gap-1.5">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <StepDot key={i} active={i === step} complete={i < step} />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              {step > 0 && step < TOTAL_STEPS - 1 && (
                <Button variant="ghost" size="sm" onClick={prev}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
              )}

              {/* Skip link — available on every step except the last */}
              {step < TOTAL_STEPS - 1 && (
                <Button variant="ghost" size="sm" onClick={dismiss}>
                  Skip
                </Button>
              )}

              {step === 0 && (
                <Button
                  size="sm"
                  onClick={next}
                  className="bg-primary hover:bg-primary/90"
                >
                  Get Started
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}

              {step === 1 && (
                <Button
                  size="sm"
                  onClick={saveProfile}
                  disabled={saving}
                  className="bg-primary hover:bg-primary/90"
                >
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save & Continue
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}

              {(step === 2 || step === 3) && (
                <Button
                  size="sm"
                  onClick={next}
                  className="bg-primary hover:bg-primary/90"
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}

              {step === TOTAL_STEPS - 1 && (
                <Button
                  size="sm"
                  onClick={completeOnboarding}
                  disabled={saving}
                  className="bg-primary hover:bg-primary/90"
                >
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Finish
                </Button>
              )}
            </div>
          </div>

          {/* Row 2: "Do not show again" checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="do-not-show-again"
              checked={doNotShowAgain}
              onCheckedChange={(v) => setDoNotShowAgain(v === true)}
            />
            <label
              htmlFor="do-not-show-again"
              className="text-xs text-muted-foreground cursor-pointer select-none"
            >
              Don't show this again
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
