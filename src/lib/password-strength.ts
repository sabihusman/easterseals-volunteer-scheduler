/**
 * Pure helper for the password-strength meter shown in the Settings page.
 *
 * The bands are intentionally generous — Supabase Auth enforces a minimum
 * of 8 characters at the API level, so this is purely a UX hint. The
 * thresholds match what was inlined in the page before the panel split.
 */
export function getPasswordStrength(pw: string): { label: string; color: string; width: string } {
  if (pw.length < 8) return { label: "Too short", color: "bg-destructive", width: "w-1/4" };
  const hasLetter = /[a-zA-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
  const score = [hasLetter, hasNumber, hasSpecial, pw.length >= 12].filter(Boolean).length;
  if (score <= 1) return { label: "Weak", color: "bg-destructive", width: "w-1/4" };
  if (score === 2) return { label: "Fair", color: "bg-amber-500", width: "w-2/4" };
  return { label: "Strong", color: "bg-primary", width: "w-full" };
}
