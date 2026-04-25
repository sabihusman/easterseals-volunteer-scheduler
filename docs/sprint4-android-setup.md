# Sprint 4 — Android App Setup Guide

Everything the code can automate is already done. This guide walks you through the manual steps
that require interactive input (keystore creation, Play Console setup).

> **Security history (Sprint 1):** An earlier version of the keystore was committed to the repo
> under `./android-release-key.jks` and later purged from git history. The current keystore
> lives **outside the repo** (recommended path: `~/.android-signing/easterseals/`) and the
> only copy of the secret material is in the maintainer's password manager + the GitHub
> Actions secret namespace. Do not commit the keystore again under any circumstances —
> if you lose the local copy, retrieve it from your password manager or have an admin
> rotate the GitHub secret. See [OPERATIONS_RUNBOOK.md § Rotating a secret](./OPERATIONS_RUNBOOK.md#rotating-a-secret)
> for the rotation procedure if a leak is suspected.

## Prerequisites (already installed)

- ✅ JDK 17 (Microsoft Build of OpenJDK) — installed via winget
- ✅ Bubblewrap CLI — installed globally via npm
- ✅ Node.js 20+
- ✅ Git

## What's already in place (code side)

| File | Purpose |
|------|---------|
| `public/.well-known/assetlinks.json` | Digital Asset Links (needs SHA-256 fingerprint) |
| `vercel.json` | Serves assetlinks.json with correct Content-Type |
| `src/main.tsx` | Detects TWA context via `document.referrer` |
| `src/pages/PrivacyPolicy.tsx` | Privacy policy at `/privacy` |
| `.github/workflows/android.yml` | CI builds on `android-v*` tag push |
| `.gitignore` | Excludes `android-release-key.jks` (defense-in-depth — the keystore should live outside the repo entirely; see security note above) |
| `vite.config.ts` | Manifest configured with `short_name: "ES Volunteers"`, `orientation: "portrait"`, maskable icons |
| `docs/play-store-listing.md` | Listing copy + checklist |

## Step 1 — Create the app in Google Play Console (~5 minutes)

1. Go to https://play.google.com/console → **Create app**
   - App name: `Easterseals Iowa Volunteer Scheduler`
   - Default language: `English (United States)`
   - App or game: `App`, Free
   - Accept declarations → **Create app**

2. Left sidebar → **Setup → App integrity → App signing** (bookmark this — you'll come back here
   after the first upload to get the SHA-256 fingerprint)

3. Left sidebar → **Testing → Internal testing** (bookmark this — you'll upload the AAB here)

## Step 2 — Run `bubblewrap init` (interactive)

Open a terminal in the project root:

```bash
cd "C:\Users\sabih\OneDrive\Desktop\VSCode\easterseals-volunteer-scheduler"
bubblewrap init --manifest https://easterseals-volunteer-scheduler.vercel.app/manifest.webmanifest --directory android/
```

**Answer the prompts EXACTLY like this** (wrong package name cannot be fixed after first upload):

| Prompt | Answer |
|--------|--------|
| Do you want Bubblewrap to install the JDK? | **No** (we already have JDK 17) |
| Path to JDK | `C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot` (or wherever `java -version` points) |
| Application package name | `org.eastersealsIowa.volunteerScheduler` |
| App name | `Easterseals Iowa Volunteer Scheduler` |
| Launcher name (short) | `ES Volunteers` |
| Theme colour | `#006B3E` |
| Background colour | `#ffffff` |
| Start URL | `/` |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Key store path | `~/.android-signing/easterseals/release-key.jks` (create the directory first: `mkdir -p ~/.android-signing/easterseals`). **Do not place the keystore inside this repo.** |
| Key store password | **Choose a strong password — SAVE IT SECURELY (1Password, Bitwarden)** |
| Key alias | `easterseals-volunteer` |
| Key password | Same as keystore password is fine |
| Min API level | `21` (Android 5.0+) |
| Target API level | `34` |

**CRITICAL:** Write down the keystore password. If you lose it, you cannot update the app on
Google Play — you'd have to publish as a new app with a different package name.

## Step 3 — Build the signed bundle

```bash
cd android/
bubblewrap build
```

Outputs:
- `android/app-release-bundle.aab` — upload this to Play Console
- `android/app-release-signed.apk` — for direct device testing

## Step 4 — Upload to Play Console (Internal testing)

1. Play Console → **Testing → Internal testing → Create new release**
2. Click **Upload**, select `android/app-release-bundle.aab`
3. Play Console scans it and confirms the package name is `org.eastersealsIowa.volunteerScheduler`
4. Add release notes (e.g. "Initial internal test build")
5. **Save → Review release → Start rollout to Internal testing**

## Step 5 — Get SHA-256 fingerprint and update assetlinks.json

1. Play Console → **Setup → App integrity → App signing**
2. Copy the **SHA-256 certificate fingerprint** (format: `AB:CD:EF:12:34:...`)
3. Edit `public/.well-known/assetlinks.json` and replace `REPLACE_WITH_SHA256_FINGERPRINT_FROM_PLAY_CONSOLE` with your fingerprint
4. Commit and push:
   ```bash
   git add public/.well-known/assetlinks.json
   git commit -m "chore: add Play Console SHA-256 to assetlinks"
   git push origin main
   ```
5. Vercel auto-deploys. Verify the file is accessible:
   ```
   https://easterseals-volunteer-scheduler.vercel.app/.well-known/assetlinks.json
   ```
6. Verify via Google's Digital Asset Links API:
   ```
   https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://easterseals-volunteer-scheduler.vercel.app&relation=delegate_permission/common.handle_all_urls
   ```
   Should return your package name and fingerprint.

## Step 6 — Install on test device

1. Play Console → **Testing → Internal testing → Testers tab → Add your Gmail address**
2. Copy the opt-in link shown on that page
3. Open the link on your Android device (signed in with the same Gmail)
4. Install the app from the Play Store
5. Open the app — if Digital Asset Links is set up correctly, the app opens full-screen with
   **no browser address bar**. That's TWA verification working.

## Step 7 — Set up GitHub Actions secrets (for automated builds)

To trigger Android builds via tag push (`git tag android-v1.0.0 && git push origin android-v1.0.0`),
add these secrets at **GitHub repo → Settings → Secrets and variables → Actions**:

| Secret name | Value |
|-------------|-------|
| `ANDROID_KEYSTORE_BASE64` | Output of `base64 -w0 ~/.android-signing/easterseals/release-key.jks` (single line) |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password you chose in Step 2 |
| `ANDROID_KEY_PASSWORD` | The key password you chose in Step 2 |

To generate the base64 keystore on Windows (PowerShell):
```powershell
cd ~\.android-signing\easterseals
certutil -encode release-key.jks keystore.b64 ; type keystore.b64
```
Copy the content (excluding the `BEGIN/END CERTIFICATE` lines) and paste into the GitHub secret.

**Never paste the base64 anywhere outside the GitHub secrets UI** — it's the full signing key. If
you suspect a leak, treat it as a credential incident: see
[OPERATIONS_RUNBOOK.md § Rotating a secret](./OPERATIONS_RUNBOOK.md#rotating-a-secret).
Rotating an Android keystore is **not possible** without publishing under a new package name —
back up the keystore in a password manager and treat it like a master key.

Then trigger a build with:
```bash
git tag android-v1.0.0
git push origin android-v1.0.0
```

The workflow will build the AAB and upload it as a GitHub artifact.

## Step 8 — Future releases

For subsequent versions:

1. Update the version in `android/twa-manifest.json`:
   ```json
   "appVersionCode": 2,
   "appVersionName": "1.0.1"
   ```
2. `cd android/ && bubblewrap build`
3. Upload new `app-release-bundle.aab` to Play Console
4. Or tag a release: `git tag android-v1.0.1 && git push origin android-v1.0.1`

## Troubleshooting

- **"App opens with address bar" (TWA not verified):** Digital Asset Links is misconfigured.
  Check `assetlinks.json` is live, has the correct SHA-256, and the package name matches exactly.
- **"Package name mismatch on upload":** You typed the wrong package name during `bubblewrap init`.
  Delete `android/` and re-run init with the correct name.
- **"Keystore password forgotten":** You cannot recover it. You'll need to publish the app under
  a new package name as a separate listing. **ALWAYS back up the keystore and password.**
