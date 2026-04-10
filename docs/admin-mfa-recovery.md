# Admin MFA Lockout Recovery

**Last updated:** 2026-04-10
**Severity:** Emergency — use only when normal login is impossible

---

## When to use

Use this ONLY when ALL of the following are true:

- **Both admin accounts are locked out** — neither admin can sign in
- **Backup codes are exhausted** — all 10 recovery codes have been used or lost
- **The MFA device is unavailable** — lost phone, factory reset, authenticator app deleted

If only ONE admin is locked out, the other admin can reset their MFA from the Admin Users page. No emergency procedure needed.

---

## Recovery procedure

### Step 1 — Retrieve the service role key

Open your password manager and find the **Supabase service role key** for the Easterseals project. It starts with `eyJhbG...` and is ~170 characters long.

### Step 2 — Run the recovery command

Copy the command below, replace the three placeholders, and run it in a terminal:

```bash
curl -X POST "SUPABASE_URL/functions/v1/admin-reset-mfa" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "TARGET_EMAIL"}'
```

| Placeholder | Replace with | Where to find it |
|---|---|---|
| `SUPABASE_URL` | `https://esycmohgumryeqteiwla.supabase.co` | Supabase dashboard → Project Settings → API |
| `SERVICE_ROLE_KEY` | The service_role key (starts with `eyJhbG...`) | Password manager |
| `TARGET_EMAIL` | The locked-out admin's email address | You know this |

### Step 3 — Verify the response

A successful response:

```json
{
  "success": true,
  "message": "Removed 1 MFA factor(s). User can now log in without 2FA and should re-enroll immediately.",
  "factors_deleted": 1
}
```

If you see `"success": false`, check:
- Is the email correct? (typos are the #1 cause)
- Is the service role key correct? (copy-paste from the password manager, don't type it)
- Is the edge function deployed? (`npx supabase functions list` should show `admin-reset-mfa` as ACTIVE)

### Step 4 — Sign in

Go to the app and sign in with email + password. There will be no MFA prompt. Proceed immediately to the post-recovery checklist.

---

## Post-recovery checklist

Complete ALL of these immediately:

- [ ] **Re-enroll MFA** — Settings → Security → Enable MFA. Scan the QR code with your authenticator app.
- [ ] **Save new backup codes** — the app generates 10 new codes. Store them in your password manager, NOT on the same device as your authenticator.
- [ ] **Verify login works** — sign out and sign back in with MFA to confirm the new enrollment works.
- [ ] **Notify the other admin** — if both admins were locked out, ensure they also re-enroll.
- [ ] **Review the audit log** — confirm the reset was recorded:
  ```bash
  npx supabase db query --linked \
    "SELECT * FROM admin_mfa_resets ORDER BY created_at DESC LIMIT 5;"
  ```
- [ ] **Rotate the service role key** if it was shared beyond the password manager during the emergency. Supabase dashboard → Project Settings → API → Regenerate. Update GitHub Actions secrets and edge function secrets afterward.

---

## Access control — who has the service role key

| Person | Access | How |
|---|---|---|
| Primary admin | Yes | Personal entry in password manager |
| Secondary admin | Yes | Personal entry in password manager |
| IT support / developer | Yes | Shared vault in password manager (1Password, Bitwarden) |
| Coordinators | **No** | — |
| Volunteers | **No** | — |

### Rules

- **Store only in a password manager** — never in code, config files, Slack, email, or shared documents
- **Rotate the key** when someone with access leaves the project
- **Never commit to git** — it's already in `.env` and GitHub Actions secrets, not in the repository

---

## Preventing future lockouts

1. **Use different authenticator apps** — both admins should NOT rely on the same app. If one uses Google Authenticator, the other should use Authy, 1Password, or Microsoft Authenticator.
2. **Store backup codes in a password manager** — not on paper, not in a notes app on the same phone as the authenticator.
3. **Test this procedure once a year** — run the curl command against a non-admin test account to confirm the edge function is deployed and working. Check that the audit log records the test.
4. **Consider a third admin** — the app currently caps admins at 2. If the organization grows, lifting this cap (code change in `AdminUsers.tsx`) reduces the risk of total lockout.

---

*End of runbook.*
