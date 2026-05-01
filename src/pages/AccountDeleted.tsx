import { Link } from "react-router-dom";

/**
 * Public confirmation page shown after a successful self-delete.
 *
 * No auth required (the user no longer exists). No nav. Single
 * "Return to homepage" link. Surfaces the same plain-language
 * confirmation the destructive-action modal led the user to expect.
 *
 * Lives at /account-deleted (added to App.tsx route table). Accessing
 * this route directly while still authenticated is harmless — the
 * page doesn't read or assume any session state.
 */
export default function AccountDeleted() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">
          Your account has been deleted
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Thank you for your time. Your account, profile, and active bookings
          have been removed. Your recorded volunteer hours have been retained
          for reporting but are no longer linked to your name.
        </p>
        <p className="text-muted-foreground">
          If you change your mind, you can register a new account at any time.
        </p>
        <Link
          to="/auth"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Return to homepage
        </Link>
      </div>
    </div>
  );
}
