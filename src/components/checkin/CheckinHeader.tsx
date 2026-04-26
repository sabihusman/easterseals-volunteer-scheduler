import { Leaf } from "lucide-react";

/**
 * Shared header for every state of the CheckIn page. Consistent branding
 * across validating / login / matching / confirm / success.
 */
export function CheckinHeader() {
  return (
    <div className="text-center space-y-2">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary">
        <Leaf className="h-7 w-7 text-primary-foreground" />
      </div>
      <h1 className="text-2xl font-bold">Easterseals Iowa</h1>
      <p className="text-muted-foreground">Volunteer Check-In</p>
    </div>
  );
}
