# Google Play Store Listing — Easterseals Iowa Volunteer Scheduler

## App details

- **Package name:** `org.eastersealsIowa.volunteerScheduler` (permanent, cannot change)
- **Category:** Productivity
- **Content rating:** Everyone
- **Developer contact email:** *(add your email)*
- **Website:** https://easterseals-volunteer-scheduler.vercel.app
- **Privacy policy URL:** https://easterseals-volunteer-scheduler.vercel.app/privacy

## Short description (80 chars max)

> Schedule and manage your Easterseals Iowa volunteer shifts.

## Full description (4000 chars max)

Easterseals Iowa Volunteer Scheduler is the official app for volunteers supporting Easterseals
Iowa's programs and services. Sign up for shifts, track your hours, communicate with
coordinators, and manage your volunteer documents — all from one place.

**Key Features:**

📅 **Browse and Book Shifts**
Find volunteer opportunities that match your interests and availability. Our smart recommendation
engine suggests shifts based on your preferences and past activity.

⏰ **Shift Reminders**
Get automatic 24-hour and 2-hour reminders for your upcoming shifts via email, SMS, or in-app
notifications. Never miss a shift again.

📊 **Track Your Impact**
See your total volunteer hours, consistency score, and earned points. Monitor your progress with
detailed charts showing your contributions over time.

💬 **Stay Connected**
Message coordinators directly through the app. Get real-time updates about shift changes,
cancellations, and new opportunities.

📋 **Document Management**
Upload required documents like background check certificates and training certifications. Track
compliance status and get reminders before documents expire.

🗓️ **Calendar Sync**
Subscribe your personal calendar (Google, Apple, Outlook) to see your shifts automatically.

🏆 **Recognition & Leaderboards**
Earn points for completed shifts, high ratings, and hour milestones. See where you rank among
fellow volunteers.

🔒 **Secure & Private**
Protect your account with two-factor authentication. Control which notifications you receive and
manage your privacy preferences.

**Who is this app for?**

This app is for active volunteers of Easterseals Iowa. If you're interested in becoming a
volunteer, visit https://ia.easterseals.com/get-involved to learn more.

**About Easterseals Iowa**

Easterseals Iowa provides exceptional services, education, outreach, and advocacy so that people
living with disabilities can live, learn, work and play in our communities. Our volunteers are
essential to making our programs possible.

## Screenshots required

Phone screenshots (min 2, max 8, 1080×1920px recommended):

1. **Volunteer Dashboard** — showing upcoming shifts, hours, points
2. **Browse Shifts** — list of available shifts with filter/search
3. **Shift Detail** — booking confirmation with shift details
4. **Shift History** — past shifts with hours breakdown
5. **Messages** — conversation with a coordinator
6. **Settings** — notification preferences and theme toggle

## Feature graphic

- **Size:** 1024×500px banner
- Use Easterseals Iowa brand colors (green #006B3E)
- Include the logo and app name
- Consider showing a volunteer in action

## App icon

- Already created: `public/icon-512.png` (512×512px, maskable)

## Content rating questionnaire

- Contains no violence, sexual content, profanity, gambling
- Shares user location: No (optional phone number for SMS only)
- Collects personal info: Yes (name, email, phone) — required for volunteer scheduling
- Target audience: 13+

## Data safety section

Declare the following data collection:

**Personal info:**
- Name — collected, shared with admin/coordinators, required
- Email — collected, shared with admin/coordinators, required
- Phone number — collected, optional, used for SMS notifications
- Emergency contact — collected, shared with admin, optional

**App activity:**
- App interactions — collected for analytics, anonymized

**Device or other IDs:**
- None

**Data is encrypted in transit:** Yes (HTTPS)
**Users can request data deletion:** Yes (via Settings → Delete Account)

## Release tracks

1. **Internal testing** — first upload for SHA-256 fingerprint retrieval
2. **Closed testing** — invite Easterseals Iowa staff + test volunteers
3. **Production** — public release after thorough testing

## Pre-launch checklist

- [ ] `public/.well-known/assetlinks.json` deployed with correct SHA-256 fingerprint
- [ ] Privacy policy page deployed at `/privacy`
- [ ] Data safety form completed in Play Console
- [ ] All screenshots uploaded
- [ ] Feature graphic uploaded
- [ ] Content rating questionnaire completed
- [ ] Tested on a physical Android device (no address bar = TWA verified)
- [ ] Email notifications working from app (MailerSend domain verified)
- [ ] SMS notifications working (Twilio account upgraded from trial)
