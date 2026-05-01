/**
 * Compile-time feature flags for the 90-day pilot dark-launch.
 *
 * Three features are intentionally hidden from end users for the
 * duration of the pilot:
 *
 *   - In-app messenger
 *   - Volunteer document uploads
 *   - Volunteer notes (the /notes page AND the per-booking add-note
 *     dialog inside ShiftHistory, AND the admin shift-notes audit
 *     panel inside AdminSettings)
 *
 * The dark-launch uses the ROUTE-HIDE pattern (not RLS-deny):
 *   - Routes are not registered when the flag is false → URLs 404
 *     via the catch-all <Route path="*" />.
 *   - Sidebar / mobile / header nav entries are filtered out.
 *   - In-page CTAs that surface the feature are conditionally
 *     rendered.
 *   - Frontend notification fan-out sites that reference these
 *     features short-circuit early.
 *
 * What's intentionally NOT done:
 *   - RLS policies are unchanged (the brief explicitly excludes them)
 *   - Database tables, triggers, RPC functions, and migrations are
 *     unchanged
 *   - Edge functions and storage buckets are unchanged
 *   - Component / page source files are kept (only their
 *     route registrations are dropped)
 *
 * To re-enable for pilot end:
 *   Flip the corresponding boolean below to `true`. That single
 *   change re-registers the route, restores the nav entry, and
 *   unblocks the frontend fan-out gates.
 *
 * Why a TS module rather than environment variables:
 *   - Tree-shakeable: the bundler can drop disabled-feature code
 *     paths entirely once the flag is statically false.
 *   - No runtime startup cost or env-var-mismatch failure mode.
 *   - Reverting the pilot is a single-file diff that's reviewable
 *     and revertible.
 *
 * Why no environment-variable override:
 *   - The pilot end-state is a code change ("we're going live") that
 *     should be visible in the diff and PR review process. An env-var
 *     override would let prod silently diverge from staging.
 */

export const MESSAGING_ENABLED = false;
export const DOCUMENTS_ENABLED = false;
export const NOTES_ENABLED = false;
