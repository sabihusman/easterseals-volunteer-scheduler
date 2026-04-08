# E2E booking lifecycle tests

Standalone Playwright tests that exercise the booking state machine via
the live Supabase REST API and assert counter invariants after every
state transition.

## Why these exist

Every counter-drift bug we've fixed in the booking pipeline went
unnoticed for an unknown amount of time in production:

- `validate_booking_slot_count` was double-incrementing
- `sync_booked_slots` was silently blocked by RLS
- `sync_booked_slots` missed the `cancelled \u2192 confirmed` re-activation
- `sync_slot_booked_count` was silently clamping overbooked sub-slots

A single assertion that
`shifts.booked_slots == COUNT(confirmed shift_bookings)` after each
booking would have caught all of them. These tests are that assertion.

## Run

```bash
SUPABASE_URL=https://esycmohgumryeqteiwla.supabase.co \
SUPABASE_ANON_KEY=<anon_key> \
npx playwright test --config e2e/playwright.config.ts
```

The tests use the QA fixture users (`sabih.usman@live.com`,
`anam@live.ca`, `sabih-usman@uiowa.edu`) so they require those accounts
to exist with password `Demo1234$`. They create their own test shift in
the Adult Day Program (Life Club) department and clean it up in
`afterAll`.

## Coverage

`booking-lifecycle.spec.ts` runs the full lifecycle:

1. Coordinator creates a 1-slot shift (most stringent invariant target)
2. Vol A books \u2192 expected `confirmed`, counter 1, status `full`
3. Vol B books with `requested = confirmed` \u2192 expected auto-demote to
   `waitlisted` (server-side via `validate_booking_slot_count`)
4. Vol A cancels \u2192 promotion trigger fires \u2192 Vol B gets
   `waitlist_offer_expires_at` set
5. Vol B calls `waitlist_accept` \u2192 promoted to `confirmed`, counter
   back to 1, status back to `full`

After every step, the counter invariant is checked:

- `shifts.booked_slots == COUNT(*) WHERE booking_status='confirmed'`
- `0 <= booked_slots <= total_slots`
- `status == 'full'` iff `booked_slots >= total_slots` else `'open'`

## Adding new tests

When adding a new booking flow (e.g. group bookings, recurring shift
generation, slot subrange selection), add a `test()` block here. The
helpers `assertCounterInvariant`, `confirmedBookingCount`, and
`shiftRow` are reusable.
