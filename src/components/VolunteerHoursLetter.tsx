import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface CompletedShift {
  shift_date: string;
  title: string;
  department: string;
  hours: number;
}

export function VolunteerHoursLetter() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!user || !profile) return;
    setGenerating(true);

    // Fetch completed bookings with final hours
    const today = new Date().toISOString().split("T")[0];
    const { data: bookings, error } = await supabase
      .from("shift_bookings")
      .select("id, final_hours, confirmed_at, shifts(title, shift_date, departments(name))")
      .eq("volunteer_id", user.id)
      .eq("confirmation_status", "confirmed")
      .eq("booking_status", "confirmed")
      .not("final_hours", "is", null)
      .order("created_at", { ascending: false });

    if (error || !bookings) {
      toast({ variant: "destructive", title: "Error", description: "Could not fetch your hours." });
      setGenerating(false);
      return;
    }

    // Filter only past shifts
    const completedShifts: CompletedShift[] = bookings
      .filter((b: any) => b.shifts?.shift_date && b.shifts.shift_date < today)
      .map((b: any) => ({
        shift_date: b.shifts.shift_date,
        title: b.shifts.title || "Volunteer Shift",
        department: b.shifts.departments?.name || "General",
        hours: b.final_hours,
      }))
      .sort((a: CompletedShift, b: CompletedShift) => a.shift_date.localeCompare(b.shift_date));

    if (completedShifts.length === 0) {
      toast({ variant: "destructive", title: "No completed hours", description: "You don't have any confirmed completed shifts yet." });
      setGenerating(false);
      return;
    }

    const totalHours = completedShifts.reduce((sum, s) => sum + s.hours, 0);
    const earliestDate = completedShifts[0].shift_date;
    const latestDate = completedShifts[completedShifts.length - 1].shift_date;

    // Fetch admin name for signature
    const { data: adminProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("role", "admin")
      .limit(1)
      .single();

    const adminName = adminProfile?.full_name || "Program Administrator";
    const volunteerName = profile.full_name || "Volunteer";
    const generatedDate = format(new Date(), "MMMM d, yyyy");
    const formattedEarliest = format(new Date(earliestDate + "T12:00:00"), "MMMM d, yyyy");
    const formattedLatest = format(new Date(latestDate + "T12:00:00"), "MMMM d, yyyy");

    // Build shift rows
    const shiftRows = completedShifts.map((s) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">
          ${format(new Date(s.shift_date + "T12:00:00"), "MMM d, yyyy")}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">
          ${s.title}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">
          ${s.department}
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right; font-weight: 600;">
          ${s.hours}
        </td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Volunteer Hours Confirmation - ${volunteerName}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      color: #1a1a1a;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 0;
      position: relative;
    }

    /* Header / Letterhead */
    .header {
      background: #006B3E;
      padding: 32px 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .logo-dots {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }
    .logo-dots span {
      width: 8px;
      height: 8px;
      background: rgba(255,255,255,0.7);
      border-radius: 50%;
      display: block;
    }
    .logo-dots .bottom-row { grid-column: 1 / -1; display: flex; justify-content: center; gap: 5px; }
    .org-name {
      color: #fff;
      font-size: 24px;
      font-weight: 800;
      line-height: 1.2;
    }
    .org-name .sub {
      color: rgba(255,255,255,0.8);
      font-size: 13px;
      font-weight: 400;
      display: block;
      margin-top: 2px;
    }
    .header-right {
      color: rgba(255,255,255,0.85);
      font-size: 12px;
      text-align: right;
      line-height: 1.6;
    }

    /* Green accent bar */
    .accent-bar {
      height: 4px;
      background: linear-gradient(90deg, #006B3E 0%, #00a35e 50%, #006B3E 100%);
    }

    /* Content */
    .content {
      padding: 40px 48px 32px;
    }
    .doc-title {
      font-size: 20px;
      font-weight: 700;
      color: #006B3E;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 6px;
    }
    .doc-date {
      font-size: 13px;
      color: #666;
      margin-bottom: 28px;
    }
    .body-text {
      font-size: 14px;
      line-height: 1.8;
      color: #333;
      margin-bottom: 24px;
    }
    .body-text strong {
      color: #1a1a1a;
    }
    .highlight-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 24px;
    }
    .highlight-stat {
      text-align: center;
    }
    .highlight-stat .number {
      font-size: 32px;
      font-weight: 800;
      color: #006B3E;
      line-height: 1;
    }
    .highlight-stat .label {
      font-size: 11px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }
    .highlight-divider {
      width: 1px;
      height: 40px;
      background: #d1d5db;
    }

    /* Table */
    .table-section h3 {
      font-size: 14px;
      font-weight: 700;
      color: #006B3E;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    thead th {
      background: #006B3E;
      color: #fff;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    thead th:last-child { text-align: right; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .total-row td {
      padding: 10px 12px;
      font-weight: 700;
      font-size: 14px;
      border-top: 2px solid #006B3E;
      background: #f0fdf4 !important;
    }

    /* Signature */
    .signature-section {
      margin-top: 40px;
      padding-top: 20px;
    }
    .signature-line {
      width: 250px;
      border-top: 1px solid #333;
      padding-top: 6px;
      margin-top: 48px;
    }
    .sig-name {
      font-weight: 700;
      font-size: 14px;
      color: #1a1a1a;
    }
    .sig-title {
      font-size: 12px;
      color: #666;
    }
    .sig-org {
      font-size: 12px;
      color: #006B3E;
      font-weight: 600;
    }

    /* Footer */
    .footer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: #f9fafb;
      border-top: 1px solid #e5e7eb;
      padding: 16px 48px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer-left {
      font-size: 11px;
      color: #999;
      line-height: 1.5;
    }
    .footer-right {
      font-size: 10px;
      color: #bbb;
      text-align: right;
    }

    @media print {
      body { background: #fff; }
      .page { margin: 0; width: 100%; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header / Letterhead -->
    <div class="header">
      <div class="header-left">
        <div class="logo-dots">
          <span></span><span></span><span></span>
          <span></span><span></span><span></span>
          <div class="bottom-row"><span></span><span></span></div>
        </div>
        <div class="org-name">
          easterseals<br>iowa
          <span class="sub">Changing the way the world defines and views disability</span>
        </div>
      </div>
      <div class="header-right">
        401 NE 66th Avenue<br>
        Des Moines, IA 50313<br>
        (515) 289-8323<br>
        ia.easterseals.com
      </div>
    </div>
    <div class="accent-bar"></div>

    <!-- Content -->
    <div class="content">
      <div class="doc-title">Volunteer Service Confirmation Letter</div>
      <div class="doc-date">${generatedDate}</div>

      <p class="body-text">
        To Whom It May Concern,
      </p>

      <p class="body-text">
        This letter confirms that <strong>${volunteerName}</strong> has served as a volunteer
        with Easterseals Iowa between <strong>${formattedEarliest}</strong> and
        <strong>${formattedLatest}</strong>. During this period, ${volunteerName} completed
        a total of <strong>${totalHours} hours</strong> of verified volunteer service across
        ${completedShifts.length} shift${completedShifts.length !== 1 ? "s" : ""}.
      </p>

      <!-- Highlight Box -->
      <div class="highlight-box">
        <div class="highlight-stat">
          <div class="number">${totalHours}</div>
          <div class="label">Total Hours</div>
        </div>
        <div class="highlight-divider"></div>
        <div class="highlight-stat">
          <div class="number">${completedShifts.length}</div>
          <div class="label">Shifts Completed</div>
        </div>
        <div class="highlight-divider"></div>
        <div class="highlight-stat">
          <div class="number">${formattedEarliest.split(" ")[0]} ${formattedEarliest.split(" ")[2] || ""}</div>
          <div class="label">Service Period Start</div>
        </div>
      </div>

      <!-- Shift Breakdown -->
      <div class="table-section">
        <h3>Shift Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Shift</th>
              <th>Department</th>
              <th style="text-align: right;">Hours</th>
            </tr>
          </thead>
          <tbody>
            ${shiftRows}
            <tr class="total-row">
              <td colspan="3">Total Verified Hours</td>
              <td style="text-align: right;">${totalHours}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="body-text">
        All hours listed above have been verified and confirmed by Easterseals Iowa staff.
        We greatly appreciate ${volunteerName}'s dedication and service to our mission of
        providing essential services to children and adults with disabilities and their families.
      </p>

      <p class="body-text">
        Should you require any additional information regarding this volunteer's service,
        please do not hesitate to contact us.
      </p>

      <!-- Signature -->
      <div class="signature-section">
        <p style="font-size: 14px; color: #333;">Sincerely,</p>
        <div class="signature-line">
          <div class="sig-name">${adminName}</div>
          <div class="sig-title">Program Administrator</div>
          <div class="sig-org">Easterseals Iowa</div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-left">
        Easterseals Iowa &middot; 401 NE 66th Avenue, Des Moines, IA 50313<br>
        Part of the Easterseals National Network &middot; easterseals.com
      </div>
      <div class="footer-right">
        Document generated on ${generatedDate}<br>
        Ref: VOL-${user.id.slice(0, 8).toUpperCase()}
      </div>
    </div>
  </div>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ variant: "destructive", title: "Popup blocked", description: "Please allow popups to download the letter." });
      setGenerating(false);
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };

    setGenerating(false);
  };

  const hasHours = (profile?.total_hours ?? 0) > 0;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleGenerate}
      disabled={generating || !hasHours}
      title={!hasHours ? "Complete at least one shift to generate a letter" : "Download your volunteer hours confirmation letter as PDF"}
    >
      {generating ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <FileDown className="h-4 w-4 mr-1" />
      )}
      Hours Letter
    </Button>
  );
}
