import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FileText, Mail } from "lucide-react";

/**
 * Temporary fallback page during the document-request system rollout.
 *
 * Background: PR #154 (Phase 2 PR 1 of the document-request system)
 * inverts document uploads from "volunteer-initiated against any active
 * document type" to "admin-requested per-document with acknowledgment
 * gate." The DB now requires every volunteer_documents row to have a
 * parent document_requests row, and RLS enforces that volunteers can
 * only INSERT against an active pending request.
 *
 * The full new UI (active-requests list + upload form + acknowledgment
 * gate) lands in PR 3 of the rollout. Between PR 1 and PR 3, this page
 * shows a placeholder so volunteers don't see a broken upload UI.
 *
 * When PR 3 ships, this file is rewritten — same path (/documents),
 * new component tree.
 *
 * See `docs/proposals/document-request-system.md` §8.6 (sequencing
 * constraint) for the full reasoning.
 */
export default function VolunteerDocuments() {
  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Document uploads are being upgraded</CardTitle>
          <CardDescription>
            We're rolling out a new document-request workflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Going forward, your administrator will request specific documents from
            you. When a request is created, you'll be able to upload that document
            here. You no longer choose which document type to upload —
            the administrator initiates each request individually.
          </p>
          <p>
            The full upload interface returns shortly. If you need to submit a
            document urgently before then, please contact your administrator
            directly.
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs">
              Questions? Reach out to your Easterseals administrator.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
