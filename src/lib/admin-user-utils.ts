import type { AdminUserRole } from "@/hooks/useAdminUsers";

/**
 * Pure helpers + constants for the AdminUsers page. No React, no toast,
 * no supabase — everything in here is safe to test in isolation.
 */

/** Generates a 14-char password from an alphabet that excludes look-alike chars (0/O, 1/l, etc). */
export function generatePassword(length = 14): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join("");
}

export interface AddUserValidation {
  valid: boolean;
  nameError: string;
  emailError: string;
}

/**
 * Validates the Add User dialog form. Returns a pure result the caller
 * uses to set its own error state (lib stays free of React state mutation).
 */
export function validateAddUser(name: string, email: string): AddUserValidation {
  let valid = true;
  let nameError = "";
  let emailError = "";
  const trimName = name.trim();
  const trimEmail = email.trim();
  if (!trimName || trimName.length < 2 || trimName.length > 100) {
    nameError = "Name must be 2–100 characters";
    valid = false;
  }
  if (!trimEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail) || trimEmail.length > 255) {
    emailError = "Enter a valid email (max 255 chars)";
    valid = false;
  }
  return { valid, nameError, emailError };
}

/** Tailwind class for the role badge — preserves the raw hsl() values from the original page. */
export const roleBadgeClass: Record<AdminUserRole, string> = {
  admin: "bg-[hsl(153,100%,21%)] text-white",
  coordinator: "bg-[hsl(221,100%,27%)] text-white",
  volunteer: "bg-muted text-muted-foreground",
};

/** Tailwind class for the BG-check status badge. */
export function getBgCheckBadgeClass(status: string): string {
  const map: Record<string, string> = {
    cleared: "bg-success text-success-foreground",
    pending: "bg-warning text-warning-foreground",
    failed: "bg-destructive text-destructive-foreground",
    expired: "bg-muted text-muted-foreground",
  };
  return map[status] || "";
}
