# Project Memory

## Core
Brand: Easterseals green #006B3E (HSL 153 100% 21%). Clean, professional, WCAG 2.1 AA.
Supabase external project. No new tables — use existing schema only.
Roles: volunteer, coordinator, admin. New users default volunteer + inactive.
Storage bucket: shift-attachments (private, RLS enforced).

## Memories
- [Design tokens](mem://design/tokens) — Easterseals green primary, sidebar dark green, success/warning tokens
- [Auth flow](mem://features/auth) — Email/password, Google SSO only, demo logins, TOS checkbox, password reset
- [Role routing](mem://features/routing) — Volunteer→/dashboard, Coordinator→/coordinator, Admin→/admin
- [PRD features](mem://features/prd) — Calendar view, check-in, iCal export, CSV export, onboarding checklist, notification bell, milestone badges, coverage alerts
