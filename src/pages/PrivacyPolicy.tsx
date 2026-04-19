import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Leaf, ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
            <Leaf className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Easterseals Iowa Volunteer Scheduler</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-3xl">Privacy Policy</CardTitle>
            <p className="text-sm text-muted-foreground">Last updated: April 6, 2026</p>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none space-y-4 text-foreground">
            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Introduction</h2>
              <p>
                Easterseals Iowa ("we," "us," or "our") operates the Volunteer Scheduler application
                (the "Service"). This Privacy Policy explains how we collect, use, and protect your
                personal information when you use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Information We Collect</h2>
              <p>When you register and use the Service, we collect:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Account information:</strong> full name, email address, phone number (optional), emergency contact name and phone number</li>
                <li><strong>Volunteer data:</strong> shift sign-ups, hours worked, shift confirmations, ratings, feedback</li>
                <li><strong>Documents:</strong> background check certificates, waivers, and other compliance documents you upload</li>
                <li><strong>Communications:</strong> messages you send through the in-app messaging system</li>
                <li><strong>Usage data:</strong> anonymized analytics (page views, clicks) via Google Analytics 4 — no personally identifiable information</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">How We Use Your Information</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>To schedule and manage your volunteer shifts</li>
                <li>To verify background check status when required by a shift</li>
                <li>To send shift reminders, confirmations, and cancellation notices via email and/or SMS</li>
                <li>To enable communication between volunteers and coordinators</li>
                <li>To track volunteer hours for recognition and reporting</li>
                <li>To improve the Service based on aggregated usage patterns</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Where Your Data Is Stored</h2>
              <p>
                Your data is stored on Supabase servers located in the United States. Email delivery
                is handled by MailerSend and SMS by Twilio. We never sell your personal information to
                third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Data Sharing</h2>
              <p>We share your information only with:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Coordinators and administrators</strong> within Easterseals Iowa who manage your volunteer activities</li>
                <li><strong>Service providers</strong> (Supabase, MailerSend, Twilio) that help us operate the Service under strict confidentiality agreements</li>
                <li><strong>Law enforcement</strong> when required by law or to protect our legal rights</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Your Rights</h2>
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Access the personal information we hold about you</li>
                <li>Correct any inaccurate information</li>
                <li>Delete your account and all associated data (available in Settings)</li>
                <li>Opt out of email, SMS, or in-app notifications at any time</li>
                <li>Request a copy of your volunteer hours and history</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Security</h2>
              <p>
                We use industry-standard security measures including encrypted connections (HTTPS),
                row-level security policies on the database, two-factor authentication (optional),
                and Cloudflare Turnstile bot protection. However, no system is 100% secure, and you
                are responsible for keeping your account credentials confidential.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Children's Privacy</h2>
              <p>
                The Service is not intended for children under 13. We do not knowingly collect
                information from children under 13. If you are a parent or guardian and believe
                your child has provided us with personal information, please contact us.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of any
                significant changes by posting the new policy on this page and updating the
                "Last updated" date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mt-4 mb-2">Contact Us</h2>
              <p>
                If you have questions about this Privacy Policy or wish to exercise your rights,
                please contact us:
              </p>
              <div className="bg-muted p-4 rounded-md mt-2">
                <p><strong>Easterseals Iowa</strong></p>
                <p>401 NE 66th Avenue</p>
                <p>Des Moines, IA 50313</p>
                <p>Phone: (515) 289-8323</p>
                <p>Email: privacy@eastersealsia.org</p>
              </div>
            </section>
          </CardContent>
        </Card>

        <div className="mt-6">
          <Link to="/">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to App
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
